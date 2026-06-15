import { describe, it, expect } from "vitest";
import { synthTest, hasResource, resourceOfType } from "../src/testing/index.js";
import { mkVPC, mkSubnet } from "../src/generated/ec2.js";
import { fargateService } from "../src/boxes/fargate.js";

function makeTestVpc() {
  const vpcResource = mkVPC("TestVPC", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
  });

  const pubA = mkSubnet("PubA", { vpcId: vpcResource, cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a" });
  const pubB = mkSubnet("PubB", { vpcId: vpcResource, cidrBlock: "10.0.2.0/24", availabilityZone: "us-east-1b" });
  const privA = mkSubnet("PrivA", { vpcId: vpcResource, cidrBlock: "10.0.10.0/24", availabilityZone: "us-east-1a" });
  const privB = mkSubnet("PrivB", { vpcId: vpcResource, cidrBlock: "10.0.11.0/24", availabilityZone: "us-east-1b" });

  return { vpcResource, pubSubnets: [pubA, pubB], privSubnets: [privA, privB] };
}

describe("fargateService", () => {
  it("creates a complete Fargate service with ALB", () => {
    const template = synthTest(() => {
      const { vpcResource, pubSubnets, privSubnets } = makeTestVpc();

      fargateService("WebApp", {
        vpc: vpcResource,
        subnets: privSubnets,
        albSubnets: pubSubnets,
        container: {
          image: "nginx:latest",
          port: 80,
        },
      });
    });

    expect(hasResource(template, "WebAppCluster", { type: "AWS::ECS::Cluster" })).toBe(true);
    expect(hasResource(template, "WebAppTaskDef", { type: "AWS::ECS::TaskDefinition" })).toBe(true);
    expect(hasResource(template, "WebAppService", { type: "AWS::ECS::Service" })).toBe(true);
    expect(hasResource(template, "WebAppALB", { type: "AWS::ElasticLoadBalancingV2::LoadBalancer" })).toBe(true);
    expect(hasResource(template, "WebAppTG", { type: "AWS::ElasticLoadBalancingV2::TargetGroup" })).toBe(true);
    expect(hasResource(template, "WebAppListener", { type: "AWS::ElasticLoadBalancingV2::Listener" })).toBe(true);
    expect(hasResource(template, "WebAppLogs", { type: "AWS::Logs::LogGroup" })).toBe(true);

    // Two security groups: one for ALB, one for tasks
    const sgs = resourceOfType(template, "AWS::EC2::SecurityGroup");
    expect(sgs.length).toBe(2);

    // Two IAM roles: execution role + task role
    const roles = resourceOfType(template, "AWS::IAM::Role");
    expect(roles.length).toBe(2);
  });

  it("returns typed outputs for downstream wiring", () => {
    synthTest(() => {
      const { vpcResource, pubSubnets, privSubnets } = makeTestVpc();

      const result = fargateService("Api", {
        vpc: vpcResource,
        subnets: privSubnets,
        albSubnets: pubSubnets,
        container: {
          image: "my-app:v1",
          port: 8080,
          environment: { NODE_ENV: "production" },
        },
        desiredCount: 3,
        cpu: "512",
        memory: "1024",
      });

      expect(result.cluster.logicalId).toBe("ApiCluster");
      expect(result.service.logicalId).toBe("ApiService");
      expect(result.taskDefinition.logicalId).toBe("ApiTaskDef");
      expect(result.alb.logicalId).toBe("ApiALB");
      expect(result.logGroup.logicalId).toBe("ApiLogs");
    });
  });
});