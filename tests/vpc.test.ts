import { describe, it, expect } from "vitest";
import { synthTest, hasResource, resourceOfType, resourceCount } from "../src/testing/index.js";
import { vpc } from "../src/boxes/vpc.js";

describe("vpc", () => {
  it("creates a VPC with public and private subnets across 2 AZs", () => {
    const template = synthTest(() => {
      vpc("Main", {
        cidrBlock: "10.0.0.0/16",
        availabilityZones: ["us-east-1a", "us-east-1b"],
        publicSubnetCidrs: ["10.0.1.0/24", "10.0.2.0/24"],
        privateSubnetCidrs: ["10.0.10.0/24", "10.0.11.0/24"],
      });
    });

    expect(hasResource(template, "Main", { type: "AWS::EC2::VPC" })).toBe(true);
    expect(hasResource(template, "MainIGW", { type: "AWS::EC2::InternetGateway" })).toBe(true);
    expect(hasResource(template, "MainIGWAttachment", { type: "AWS::EC2::VPCGatewayAttachment" })).toBe(true);

    // 2 public + 2 private subnets
    const subnets = resourceOfType(template, "AWS::EC2::Subnet");
    expect(subnets.length).toBe(4);

    // 1 public + 2 private route tables
    const routeTables = resourceOfType(template, "AWS::EC2::RouteTable");
    expect(routeTables.length).toBe(3);

    // 2 NAT Gateways + 2 EIPs
    const nats = resourceOfType(template, "AWS::EC2::NatGateway");
    expect(nats.length).toBe(2);
    const eips = resourceOfType(template, "AWS::EC2::EIP");
    expect(eips.length).toBe(2);

    // 1 public default route + 2 private default routes
    const routes = resourceOfType(template, "AWS::EC2::Route");
    expect(routes.length).toBe(3);

    // 4 subnet-route-table associations
    const assocs = resourceOfType(template, "AWS::EC2::SubnetRouteTableAssociation");
    expect(assocs.length).toBe(4);
  });

  it("skips NAT gateways when enableNat is false", () => {
    const template = synthTest(() => {
      vpc("Dev", {
        cidrBlock: "10.0.0.0/16",
        availabilityZones: ["us-east-1a"],
        publicSubnetCidrs: ["10.0.1.0/24"],
        privateSubnetCidrs: ["10.0.10.0/24"],
        enableNat: false,
      });
    });

    const nats = resourceOfType(template, "AWS::EC2::NatGateway");
    expect(nats.length).toBe(0);

    const eips = resourceOfType(template, "AWS::EC2::EIP");
    expect(eips.length).toBe(0);

    // Only the public default route (no private default routes without NAT)
    const routes = resourceOfType(template, "AWS::EC2::Route");
    expect(routes.length).toBe(1);
  });

  it("returns typed outputs for downstream wiring", () => {
    synthTest(() => {
      const result = vpc("Net", {
        cidrBlock: "10.0.0.0/16",
        availabilityZones: ["us-east-1a", "us-east-1b"],
        publicSubnetCidrs: ["10.0.1.0/24", "10.0.2.0/24"],
        privateSubnetCidrs: ["10.0.10.0/24", "10.0.11.0/24"],
      });

      expect(result.vpc.logicalId).toBe("Net");
      expect(result.publicSubnets.length).toBe(2);
      expect(result.privateSubnets.length).toBe(2);
      expect(result.natGateways.length).toBe(2);
      expect(result.publicRouteTable.logicalId).toBe("NetPublic");
      expect(result.privateRouteTables.length).toBe(2);
    });
  });
});