import { describe, expect, it } from "vitest";
import { resourceOfType, synthTest } from "../src/testing/index.js";
import { mkRouteTable, mkSecurityGroup, mkSubnet, mkVPC } from "../src/generated/ec2.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import { fargateService, } from "../src/boxes/fargate.js";
import {
  addGatewayEndpoint,
  addInterfaceEndpoint,
  allowFrom,
  allowFromCidr,
  allowTo,
  enableFlowLogs,
  peerVpcs,
} from "../src/boxes/vpc.js";

// === Helper factories ===
function makeVpc() {
  const vpcResource = mkVPC("TestVPC", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
  });
  const subnetA = mkSubnet("SubnetA", {
    vpcId: vpcResource,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: "us-east-1a",
  });
  const subnetB = mkSubnet("SubnetB", {
    vpcId: vpcResource,
    cidrBlock: "10.0.2.0/24",
    availabilityZone: "us-east-1b",
  });
  const sg = mkSecurityGroup("TestSG", {
    groupDescription: "test sg",
    vpcId: vpcResource,
  });
  return { vpcResource, subnetA, subnetB, sg };
}

function makeFargateService() {
  const vpcResource = mkVPC("FgVPC", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
  });
  const pubA = mkSubnet("FgPubA", { vpcId: vpcResource, cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a" });
  const pubB = mkSubnet("FgPubB", { vpcId: vpcResource, cidrBlock: "10.0.2.0/24", availabilityZone: "us-east-1b" });
  const privA = mkSubnet("FgPrivA", { vpcId: vpcResource, cidrBlock: "10.0.10.0/24", availabilityZone: "us-east-1a" });
  const privB = mkSubnet("FgPrivB", { vpcId: vpcResource, cidrBlock: "10.0.11.0/24", availabilityZone: "us-east-1b" });

  return fargateService("Svc", {
    vpc: vpcResource,
    subnets: [privA, privB],
    albSubnets: [pubA, pubB],
    container: { image: "nginx:latest", port: 80 },
  });
}

// ==========================================================================
// S3 boxes
// ==========================================================================


describe("vpc/allowFrom", () => {
  it("creates an ingress rule between two security groups", () => {
    const template = synthTest(() => {
      const { vpcResource } = makeVpc();
      const sgA = mkSecurityGroup("SgA", { groupDescription: "A", vpcId: vpcResource });
      const sgB = mkSecurityGroup("SgB", { groupDescription: "B", vpcId: vpcResource });
      allowFrom(sgA, sgB, 443);
    });

    const ingress = resourceOfType(template, "AWS::EC2::SecurityGroupIngress");
    expect(ingress.length).toBe(1);
    expect((ingress[0].Properties as any).IpProtocol).toBe("tcp");
    expect((ingress[0].Properties as any).FromPort).toBe(443);
    expect((ingress[0].Properties as any).ToPort).toBe(443);
  });
});

describe("vpc/allowFromCidr", () => {
  it("creates an ingress rule from a CIDR range", () => {
    const template = synthTest(() => {
      const vpcResource = mkVPC("CidrVpc", { cidrBlock: "10.0.0.0/16", enableDnsSupport: true, enableDnsHostnames: true });
      const sg = mkSecurityGroup("CidrSG", { groupDescription: "cidr test", vpcId: vpcResource });
      allowFromCidr(sg, "10.0.0.0/8", 8080);
    });

    const ingress = resourceOfType(template, "AWS::EC2::SecurityGroupIngress");
    expect(ingress.length).toBe(1);
    expect((ingress[0].Properties as any).FromPort).toBe(8080);
    expect((ingress[0].Properties as any).ToPort).toBe(8080);
    expect((ingress[0].Properties as any).IpProtocol).toBe("tcp");
    // CidrIp should be present (may be a token reference or raw string)
    expect((ingress[0].Properties as any).CidrIp).toBeDefined();
  });
});

describe("vpc/allowTo", () => {
  it("creates an egress rule to another security group", () => {
    const template = synthTest(() => {
      const { vpcResource } = makeVpc();
      const sgSource = mkSecurityGroup("SgSrc", { groupDescription: "Source", vpcId: vpcResource });
      const sgDest = mkSecurityGroup("SgDst", { groupDescription: "Dest", vpcId: vpcResource });
      allowTo(sgSource, sgDest, 5432);
    });

    const egress = resourceOfType(template, "AWS::EC2::SecurityGroupEgress");
    expect(egress.length).toBe(1);
    expect((egress[0].Properties as any).FromPort).toBe(5432);
  });
});

describe("vpc/addGatewayEndpoint", () => {
  it("creates an S3 gateway endpoint", () => {
    const template = synthTest(() => {
      const { vpcResource } = makeVpc();
      const rt = mkRouteTable("MainRT", { vpcId: vpcResource });
      addGatewayEndpoint(vpcResource, "s3", [rt]);
    });

    const endpoints = resourceOfType(template, "AWS::EC2::VPCEndpoint");
    expect(endpoints.length).toBe(1);
    expect((endpoints[0].Properties as any).VpcEndpointType).toBe("Gateway");
  });

  it("creates a DynamoDB gateway endpoint", () => {
    const template = synthTest(() => {
      const { vpcResource } = makeVpc();
      const rt = mkRouteTable("DdbRT", { vpcId: vpcResource });
      addGatewayEndpoint(vpcResource, "dynamodb", [rt]);
    });

    const endpoints = resourceOfType(template, "AWS::EC2::VPCEndpoint");
    expect(endpoints.length).toBe(1);
    expect((endpoints[0].Properties as any).ServiceName).toContain("dynamodb");
  });
});

describe("vpc/addInterfaceEndpoint", () => {
  it("creates an interface endpoint", () => {
    const template = synthTest(() => {
      const { vpcResource, subnetA, sg } = makeVpc();
      addInterfaceEndpoint(vpcResource, "com.amazonaws.us-east-1.execute-api", [subnetA], sg);
    });

    const endpoints = resourceOfType(template, "AWS::EC2::VPCEndpoint");
    expect(endpoints.length).toBe(1);
    expect((endpoints[0].Properties as any).VpcEndpointType).toBe("Interface");
  });
});

describe("vpc/enableFlowLogs", () => {
  it("creates flow log, log group, and IAM role", () => {
    const template = synthTest(() => {
      const vpcResource = mkVPC("FlowVPC", { cidrBlock: "10.0.0.0/16", enableDnsSupport: true, enableDnsHostnames: true });
      enableFlowLogs(vpcResource);
    });

    const flowLogs = resourceOfType(template, "AWS::EC2::FlowLog");
    expect(flowLogs.length).toBe(1);
    expect((flowLogs[0].Properties as any).TrafficType).toBe("ALL");
    expect((flowLogs[0].Properties as any).ResourceType).toBe("VPC");

    const logGroups = resourceOfType(template, "AWS::Logs::LogGroup");
    expect(logGroups.length).toBe(1);
    expect((logGroups[0].Properties as any).RetentionInDays).toBe(14);

    const roles = resourceOfType(template, "AWS::IAM::Role");
    expect(roles.length).toBe(1);
  });

  it("respects custom retention and traffic type", () => {
    const template = synthTest(() => {
      const vpcResource = mkVPC("CustomFlow", { cidrBlock: "10.0.0.0/16", enableDnsSupport: true, enableDnsHostnames: true });
      enableFlowLogs(vpcResource, 30, "REJECT");
    });

    const flowLogs = resourceOfType(template, "AWS::EC2::FlowLog");
    expect((flowLogs[0].Properties as any).TrafficType).toBe("REJECT");

    const logGroups = resourceOfType(template, "AWS::Logs::LogGroup");
    expect((logGroups[0].Properties as any).RetentionInDays).toBe(30);
  });
});

describe("vpc/peerVpcs", () => {
  it("creates peering connection and bidirectional routes", () => {
    const template = synthTest(() => {
      const vpcA = mkVPC("VpcA", { cidrBlock: "10.0.0.0/16", enableDnsSupport: true, enableDnsHostnames: true });
      const vpcB = mkVPC("VpcB", { cidrBlock: "10.1.0.0/16", enableDnsSupport: true, enableDnsHostnames: true });
      const rtA = mkRouteTable("RtA", { vpcId: vpcA });
      const rtB = mkRouteTable("RtB", { vpcId: vpcB });
      peerVpcs(vpcA, rtA, "10.0.0.0/16", vpcB, rtB, "10.1.0.0/16");
    });

    const peerings = resourceOfType(template, "AWS::EC2::VPCPeeringConnection");
    expect(peerings.length).toBe(1);

    // Two routes: A->B and B->A
    const routes = resourceOfType(template, "AWS::EC2::Route");
    expect(routes.length).toBe(2);
  });
});

// ==========================================================================
// API Gateway boxes
// ==========================================================================

