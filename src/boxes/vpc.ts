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
} from "../generated/ec2.js";
import type {
  VPC,
  Subnet,
  InternetGateway,
  NatGateway,
  EIP,
  RouteTable,
  Route,
} from "../generated/ec2.js";
import { ref } from "../runtime/resource.js";
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