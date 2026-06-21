import {
  mkVPC,
  mkSubnet,
  mkInternetGateway,
  mkNatGateway,
  mkEIP,
  mkRouteTable,
  mkRoute,
  mkVPCGatewayAttachment,
  mkSubnetRouteTableAssociation,
  mkSecurityGroup,
  mkSecurityGroupIngress,
  mkSecurityGroupEgress,
  mkVPCEndpoint,
  mkFlowLog,
  mkVPCPeeringConnection,
} from "../generated/ec2.js";
import type {
  VPC,
  Subnet,
  InternetGateway,
  NatGateway,
  EIP,
  RouteTable,
  Route,
  SecurityGroup,
  SecurityGroupIngress,
  SecurityGroupEgress,
  VPCEndpoint,
  FlowLog,
  VPCPeeringConnection,
} from "../generated/ec2.js";
import { mkRole } from "../generated/iam.js";
import type { Role } from "../generated/iam.js";
import { mkLogGroup } from "../generated/logs.js";
import type { LogGroup } from "../generated/logs.js";
import { ref, deriveId, makeResource } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

// === Mid-level wiring boxes ===
// These encode common routing patterns and can be used independently
// for custom topologies.

/**
 * Attaches an Internet Gateway to a VPC and returns it.
 * This is the first step toward making subnets public.
 */
export const attachInternetGateway = box(
  "attachInternetGateway",
  (logicalId: string, vpcResource: VPC): InternetGateway => {
    const igw = mkInternetGateway(`${logicalId}IGW`, {});

    mkVPCGatewayAttachment(`${logicalId}IGWAttachment`, {
      vpcId: vpcResource,
      internetGatewayId: igw,
    });

    return igw;
  },
);

/**
 * Creates a route table with a default route to an Internet Gateway.
 * Associate subnets with this table to make them public.
 */
export const publicRouteTable = box(
  "publicRouteTable",
  (logicalId: string, vpcResource: VPC, igw: InternetGateway): RouteTable => {
    const rt = mkRouteTable(logicalId, { vpcId: vpcResource });

    mkRoute(`${logicalId}DefaultRoute`, {
      routeTableId: rt,
      destinationCidrBlock: "0.0.0.0/0",
      gatewayId: igw.internetGatewayId,
    });

    return rt;
  },
);

/**
 * Creates a NAT Gateway in a subnet (with its own EIP) and returns a route table
 * that routes 0.0.0.0/0 through it. Associate private subnets with this table.
 */
export const natRouteTable = box(
  "natRouteTable",
  (logicalId: string, vpcResource: VPC, publicSubnet: Subnet): { readonly routeTable: RouteTable; readonly natGateway: NatGateway; readonly eip: EIP } => {
    const eip = mkEIP(`${logicalId}EIP`, { domain: "vpc" });

    const nat = mkNatGateway(`${logicalId}NAT`, {
      subnetId: publicSubnet,
      allocationId: eip,
      connectivityType: "public",
    });

    const rt = mkRouteTable(`${logicalId}RT`, { vpcId: vpcResource });

    mkRoute(`${logicalId}DefaultRoute`, {
      routeTableId: rt,
      destinationCidrBlock: "0.0.0.0/0",
      natGatewayId: nat,
    });

    return { routeTable: rt, natGateway: nat, eip };
  },
);

/**
 * Associates a subnet with a route table.
 */
export const associateRouteTable = box(
  "associateRouteTable",
  (subnet: Subnet, routeTable: RouteTable): [Subnet, RouteTable] => {
    mkSubnetRouteTableAssociation(`${subnet.logicalId}${routeTable.logicalId}Assoc`, {
      subnetId: subnet,
      routeTableId: routeTable,
    });
    return [subnet, routeTable];
  },
);

// === High-level opinionated box ===

export type VpcProps = {
  cidrBlock: string;
  availabilityZones: string[];
  publicSubnetCidrs: string[];
  privateSubnetCidrs: string[];
  enableNat?: boolean;
};

export type VpcNetwork = {
  readonly vpc: VPC;
  readonly internetGateway: InternetGateway;
  readonly publicSubnets: readonly Subnet[];
  readonly privateSubnets: readonly Subnet[];
  readonly publicRouteTable: RouteTable;
  readonly privateRouteTables: readonly RouteTable[];
  readonly natGateways: readonly NatGateway[];
};

/**
 * Creates a VPC with public and private subnets across availability zones.
 *
 * This is the opinionated "happy path" for the common 2- or 3-AZ pattern.
 * For custom topologies (shared route tables, asymmetric subnets, no-NAT
 * private subnets), compose the mid-level boxes directly:
 * `attachInternetGateway`, `publicRouteTable`, `natRouteTable`, `associateRouteTable`.
 */
export const vpc = box(
  "vpc",
  (logicalId: string, props: VpcProps): VpcNetwork => {
    const { cidrBlock, availabilityZones, publicSubnetCidrs, privateSubnetCidrs, enableNat = true } = props;

    const vpcResource = mkVPC(logicalId, {
      cidrBlock,
      enableDnsSupport: true,
      enableDnsHostnames: true,
    });

    const igw = attachInternetGateway(logicalId, vpcResource);
    const pubRt = publicRouteTable(`${logicalId}Public`, vpcResource, igw);

    const publicSubnets: Subnet[] = [];
    const privateSubnets: Subnet[] = [];
    const privateRouteTables: RouteTable[] = [];
    const natGateways: NatGateway[] = [];

    for (let i = 0; i < availabilityZones.length; i++) {
      const az = availabilityZones[i];
      const suffix = az.slice(-1).toUpperCase();

      const pubSubnet = mkSubnet(`${logicalId}Public${suffix}`, {
        vpcId: vpcResource,
        cidrBlock: publicSubnetCidrs[i],
        availabilityZone: az,
        mapPublicIpOnLaunch: true,
      });
      publicSubnets.push(pubSubnet);
      associateRouteTable(pubSubnet, pubRt);

      const privSubnet = mkSubnet(`${logicalId}Private${suffix}`, {
        vpcId: vpcResource,
        cidrBlock: privateSubnetCidrs[i],
        availabilityZone: az,
      });
      privateSubnets.push(privSubnet);

      if (enableNat) {
        const { routeTable: privRt, natGateway: nat } = natRouteTable(
          `${logicalId}Private${suffix}`, vpcResource, pubSubnet,
        );
        privateRouteTables.push(privRt);
        natGateways.push(nat);
        associateRouteTable(privSubnet, privRt);
      } else {
        const privRt = mkRouteTable(`${logicalId}Private${suffix}RT`, { vpcId: vpcResource });
        privateRouteTables.push(privRt);
        associateRouteTable(privSubnet, privRt);
      }
    }

    return {
      vpc: vpcResource,
      internetGateway: igw,
      publicSubnets,
      privateSubnets,
      publicRouteTable: pubRt,
      privateRouteTables,
      natGateways,
    };
  },
);

// === Security Group rules ===

/**
 * Adds an ingress rule allowing traffic from another security group.
 * This is a wiring box: it creates a relationship between two SGs.
 */
export const allowFrom = box(
  "allowFrom",
  (target: SecurityGroup, source: SecurityGroup, port: number, protocol: string = "tcp"): [SecurityGroup, SecurityGroup, SecurityGroupIngress] => {
    const rule = mkSecurityGroupIngress(deriveId(target, source, `In${port}`), {
      groupId: target.groupId,
      sourceSecurityGroupId: source.groupId,
      ipProtocol: protocol,
      fromPort: port,
      toPort: port,
      description: `Allow ${protocol}/${port} from ${source.logicalId}`,
    } as any);
    return [target, source, rule];
  },
);

/**
 * Adds an ingress rule allowing traffic from a CIDR range.
 */
export const allowFromCidr = box(
  "allowFromCidr",
  (target: SecurityGroup, cidr: string, port: number, protocol: string = "tcp"): [SecurityGroup, SecurityGroupIngress] => {
    const rule = mkSecurityGroupIngress(deriveId(target, `Cidr${port}`), {
      groupId: target.groupId,
      cidrIp: cidr,
      ipProtocol: protocol,
      fromPort: port,
      toPort: port,
      description: `Allow ${protocol}/${port} from ${cidr}`,
    } as any);
    return [target, rule];
  },
);

/**
 * Adds an egress rule allowing traffic to another security group.
 */
export const allowTo = box(
  "allowTo",
  (source: SecurityGroup, target: SecurityGroup, port: number, protocol: string = "tcp"): [SecurityGroup, SecurityGroup, SecurityGroupEgress] => {
    const rule = mkSecurityGroupEgress(deriveId(source, target, `Out${port}`), {
      groupId: source,
      destinationSecurityGroupId: target,
      ipProtocol: protocol,
      fromPort: port,
      toPort: port,
      description: `Allow ${protocol}/${port} to ${target.logicalId}`,
    });
    return [source, target, rule];
  },
);

// === VPC Endpoints ===

/**
 * Creates a Gateway VPC endpoint (for S3 or DynamoDB) and associates it
 * with the specified route tables.
 */
export const addGatewayEndpoint = box(
  "addGatewayEndpoint",
  (vpcResource: VPC, service: "s3" | "dynamodb", routeTables: RouteTable[]): VPCEndpoint => {
    const serviceName = service === "s3"
      ? "com.amazonaws.${AWS::Region}.s3"
      : "com.amazonaws.${AWS::Region}.dynamodb";

    return mkVPCEndpoint(deriveId(vpcResource, service, "Endpoint"), {
      vpcId: vpcResource,
      serviceName,
      vpcEndpointType: "Gateway",
      routeTableIds: routeTables.map((rt) => rt.routeTableId),
    } as any);
  },
);

/**
 * Creates an Interface VPC endpoint for a given AWS service.
 * Places it in the specified subnets with a security group.
 */
export const addInterfaceEndpoint = box(
  "addInterfaceEndpoint",
  (vpcResource: VPC, serviceName: string, subnets: readonly Subnet[], securityGroup: SecurityGroup): VPCEndpoint => {
    const shortName = serviceName.split(".").pop() ?? serviceName;
    return mkVPCEndpoint(deriveId(vpcResource, shortName, "Endpoint"), {
      vpcId: vpcResource,
      serviceName,
      vpcEndpointType: "Interface",
      subnetIds: subnets.map((s) => s.subnetId),
      securityGroupIds: [securityGroup.groupId],
    } as any);
  },
);

// === Flow Logs ===

export type FlowLogResult = {
  readonly flowLog: FlowLog;
  readonly logGroup: LogGroup;
  readonly role: Role;
};

/**
 * Enables VPC Flow Logs to CloudWatch Logs. Creates an IAM role for the
 * flow log service, a CloudWatch Log Group, and the FlowLog resource.
 */
export const enableFlowLogs = box(
  "enableFlowLogs",
  (vpcResource: VPC, retentionDays: number = 14, trafficType: "ALL" | "ACCEPT" | "REJECT" = "ALL"): FlowLogResult => {
    const role = mkRole(deriveId(vpcResource, "FlowLogRole"), {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "vpc-flow-logs.amazonaws.com" },
          Action: "sts:AssumeRole",
        }],
      },
      managedPolicyArns: [] as any,
      policies: [{
        policyName: "FlowLogWrite",
        policyDocument: {
          Version: "2012-10-17",
          Statement: [{
            Effect: "Allow",
            Action: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "logs:DescribeLogGroups",
              "logs:DescribeLogStreams",
            ],
            Resource: "*",
          }],
        },
      }] as any,
    });

    const logGroup = mkLogGroup(deriveId(vpcResource, "FlowLogs"), {
      retentionInDays: retentionDays,
    });

    const flowLog = mkFlowLog(deriveId(vpcResource, "FlowLog"), {
      resourceId: vpcResource.vpcId,
      resourceType: "VPC",
      trafficType,
      logDestinationType: "cloud-watch-logs",
      logGroupName: ref(logGroup),
      deliverLogsPermissionArn: role,
    });

    return { flowLog, logGroup, role };
  },
);

// === VPC Peering ===

export type PeeringResult = {
  readonly peering: VPCPeeringConnection;
};

/**
 * Creates a VPC peering connection between two VPCs and adds routes in both
 * directions so traffic can flow between them.
 */
export const peerVpcs = box(
  "peerVpcs",
  (
    vpcA: VPC, routeTableA: RouteTable, cidrA: string,
    vpcB: VPC, routeTableB: RouteTable, cidrB: string,
  ): PeeringResult => {
    const peering = mkVPCPeeringConnection(deriveId(vpcA, vpcB, "Peering"), {
      vpcId: vpcA,
      peerVpcId: vpcB,
    });

    // Route from A to B via peering
    mkRoute(deriveId(routeTableA, vpcB, "PeerRoute"), {
      routeTableId: routeTableA,
      destinationCidrBlock: cidrB,
      vpcPeeringConnectionId: peering,
    });

    // Route from B to A via peering
    mkRoute(deriveId(routeTableB, vpcA, "PeerRoute"), {
      routeTableId: routeTableB,
      destinationCidrBlock: cidrA,
      vpcPeeringConnectionId: peering,
    });

    return { peering };
  },
);