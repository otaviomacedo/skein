import { describe, expect, it } from "vitest";
import { resetAll, resourceOfType, synthTest } from "../src/testing/index.js";
import { mkSecurityGroup, mkSubnet, mkVPC } from "../src/generated/ec2.js";
import { mkFileSystem } from "../src/generated/efs.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import {
  addSidecar,
  autoScaleService,
  enableCircuitBreaker,
  enableServiceDiscovery,
  fargateService,
  mountEfs,
} from "../src/boxes/fargate.js";

// === Helper factories ===

function makeLambda(id: string) {
  return mkLambda(id, {
    runtime: "nodejs20.x",
    handler: "index.handler",
    code: { s3Bucket: "code-bucket", s3Key: `${id.toLowerCase()}.zip` },
  });
}

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


describe("fargate/autoScaleService", () => {
  it("creates scalable target and CPU scaling policy", () => {
    const template = synthTest(() => {
      const svc = makeFargateService();
      autoScaleService(svc.service, svc.cluster, {
        minCapacity: 2,
        maxCapacity: 10,
        targetCpuUtilization: 70,
      });
    });

    const targets = resourceOfType(template, "AWS::ApplicationAutoScaling::ScalableTarget");
    expect(targets.length).toBe(1);
    expect((targets[0].Properties as any).ServiceNamespace).toBe("ecs");

    const scalePolicies = resourceOfType(template, "AWS::ApplicationAutoScaling::ScalingPolicy");
    expect(scalePolicies.length).toBe(1);
    expect(
      (scalePolicies[0].Properties as any).TargetTrackingScalingPolicyConfiguration
        .PredefinedMetricSpecification.PredefinedMetricType,
    ).toBe("ECSServiceAverageCPUUtilization");
  });

  it("creates both CPU and memory policies when both specified", () => {
    const template = synthTest(() => {
      const svc = makeFargateService();
      autoScaleService(svc.service, svc.cluster, {
        minCapacity: 1,
        maxCapacity: 20,
        targetCpuUtilization: 60,
        targetMemoryUtilization: 75,
      });
    });

    const scalePolicies = resourceOfType(template, "AWS::ApplicationAutoScaling::ScalingPolicy");
    expect(scalePolicies.length).toBe(2);
  });
});

describe("fargate/enableServiceDiscovery", () => {
  it("creates namespace and service registry", () => {
    const template = synthTest(() => {
      const svc = makeFargateService();
      const vpcResource = mkVPC("DiscVPC", { cidrBlock: "10.1.0.0/16", enableDnsSupport: true, enableDnsHostnames: true });
      enableServiceDiscovery(svc.service, vpcResource, "internal.local", "api");
    });

    const namespaces = resourceOfType(template, "AWS::ServiceDiscovery::PrivateDnsNamespace");
    expect(namespaces.length).toBe(1);
    expect((namespaces[0].Properties as any).Name).toBe("internal.local");

    const services = resourceOfType(template, "AWS::ServiceDiscovery::Service");
    expect(services.length).toBe(1);
    expect((services[0].Properties as any).Name).toBe("api");
  });
});

describe("fargate/addSidecar", () => {
  it("adds a sidecar container to task definition (return value)", () => {
    // addSidecar modifies the containerDefinitions array, which conflicts
    // on synth merge. Test the box return value directly.
    resetAll();
    const vpcResource = mkVPC("FgVPC2", { cidrBlock: "10.0.0.0/16", enableDnsSupport: true, enableDnsHostnames: true });
    const pubA = mkSubnet("P2A", { vpcId: vpcResource, cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a" });
    const pubB = mkSubnet("P2B", { vpcId: vpcResource, cidrBlock: "10.0.2.0/24", availabilityZone: "us-east-1b" });
    const privA = mkSubnet("Pr2A", { vpcId: vpcResource, cidrBlock: "10.0.10.0/24", availabilityZone: "us-east-1a" });
    const privB = mkSubnet("Pr2B", { vpcId: vpcResource, cidrBlock: "10.0.11.0/24", availabilityZone: "us-east-1b" });

    const svc = fargateService("Sc", {
      vpc: vpcResource,
      subnets: [privA, privB],
      albSubnets: [pubA, pubB],
      container: { image: "nginx:latest", port: 80 },
    });

    const result = addSidecar(svc.taskDefinition, {
      name: "datadog-agent",
      image: "datadog/agent:latest",
      port: 8125,
      environment: { DD_API_KEY: "abc123" },
    });

    const containers = (result.properties as any).containerDefinitions;
    expect(containers.length).toBe(2);
    const sidecar = containers.find((c: any) => c.name === "datadog-agent");
    expect(sidecar).toBeDefined();
    expect(sidecar.image).toBe("datadog/agent:latest");
    expect(sidecar.essential).toBe(false);
    expect(sidecar.portMappings).toEqual([{ containerPort: 8125, protocol: "tcp" }]);
  });
});

describe("fargate/enableCircuitBreaker", () => {
  it("enables deployment circuit breaker with rollback", () => {
    const template = synthTest(() => {
      const svc = makeFargateService();
      enableCircuitBreaker(svc.service);
    });

    const services = resourceOfType(template, "AWS::ECS::Service");
    expect(services.length).toBe(1);
    const deployConfig = (services[0].Properties as any).DeploymentConfiguration;
    expect(deployConfig.DeploymentCircuitBreaker).toEqual({ Enable: true, Rollback: true });
  });
});

describe("fargate/mountEfs", () => {
  it("mounts EFS volume into task definition (return value)", () => {
    // mountEfs modifies containerDefinitions and volumes arrays, which
    // conflicts on synth merge. Test the box return value directly.
    resetAll();
    const vpcResource = mkVPC("FgVPC3", { cidrBlock: "10.0.0.0/16", enableDnsSupport: true, enableDnsHostnames: true });
    const pubA = mkSubnet("P3A", { vpcId: vpcResource, cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a" });
    const pubB = mkSubnet("P3B", { vpcId: vpcResource, cidrBlock: "10.0.2.0/24", availabilityZone: "us-east-1b" });
    const privA = mkSubnet("Pr3A", { vpcId: vpcResource, cidrBlock: "10.0.10.0/24", availabilityZone: "us-east-1a" });
    const privB = mkSubnet("Pr3B", { vpcId: vpcResource, cidrBlock: "10.0.11.0/24", availabilityZone: "us-east-1b" });

    const svc = fargateService("Ef", {
      vpc: vpcResource,
      subnets: [privA, privB],
      albSubnets: [pubA, pubB],
      container: { image: "nginx:latest", port: 80 },
    });

    const fs = mkFileSystem("SharedFS", {});
    const result = mountEfs(svc.taskDefinition, fs, "Ef", "/mnt/data");

    const volumes = (result.properties as any).volumes;
    expect(volumes.length).toBe(1);
    expect(volumes[0].efsVolumeConfiguration.transitEncryption).toBe("ENABLED");

    const containers = (result.properties as any).containerDefinitions;
    const mainContainer = containers.find((c: any) => c.name === "Ef");
    expect(mainContainer.mountPoints.length).toBe(1);
    expect(mainContainer.mountPoints[0].containerPath).toBe("/mnt/data");
    expect(mainContainer.mountPoints[0].readOnly).toBe(false);
  });
});

// ==========================================================================
// VPC boxes
// ==========================================================================

