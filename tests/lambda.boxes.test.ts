import { describe, expect, it } from "vitest";
import { hasResource, resourceOfType, synthTest } from "../src/testing/index.js";
import { mkQueue } from "../src/generated/sqs.js";
import { mkSecurityGroup, mkSubnet, mkVPC } from "../src/generated/ec2.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import { addFunctionUrl, addLayers, setDeadLetterQueue, setLogRetention, setVpc, } from "../src/boxes/lambda.js";
import { fargateService, } from "../src/boxes/fargate.js";

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


describe("lambda/addLayers", () => {
  it("attaches layer ARNs to the function", () => {
    const template = synthTest(() => {
      const fn = makeLambda("LayeredFn");
      addLayers(fn, "arn:aws:lambda:us-east-1:123:layer:Shared:1", "arn:aws:lambda:us-east-1:123:layer:Utils:2");
    });

    expect(hasResource(template, "LayeredFn", {
      type: "AWS::Lambda::Function",
      properties: {
        Layers: [
          "arn:aws:lambda:us-east-1:123:layer:Shared:1",
          "arn:aws:lambda:us-east-1:123:layer:Utils:2",
        ],
      },
    })).toBe(true);
  });
});

describe("lambda/setVpc", () => {
  it("places the function in a VPC", () => {
    const template = synthTest(() => {
      const { subnetA, subnetB, sg } = makeVpc();
      const fn = makeLambda("VpcFn");
      setVpc(fn, [subnetA, subnetB], [sg]);
    });

    expect(hasResource(template, "VpcFn", {
      type: "AWS::Lambda::Function",
    })).toBe(true);
    // VpcConfig should exist on the function
    const fns = resourceOfType(template, "AWS::Lambda::Function");
    const vpcFn = fns.find((f) => (f.Properties as any).VpcConfig);
    expect(vpcFn).toBeDefined();
    expect((vpcFn!.Properties as any).VpcConfig.SubnetIds.length).toBe(2);
    expect((vpcFn!.Properties as any).VpcConfig.SecurityGroupIds.length).toBe(1);
  });
});

describe("lambda/setDeadLetterQueue", () => {
  it("configures DLQ on the function", () => {
    const template = synthTest(() => {
      const fn = makeLambda("DlqFn");
      const dlq = mkQueue("DLQ", {});
      setDeadLetterQueue(fn, dlq);
    });

    const fns = resourceOfType(template, "AWS::Lambda::Function");
    const dlqFn = fns.find((f) => (f.Properties as any).DeadLetterConfig);
    expect(dlqFn).toBeDefined();
    expect((dlqFn!.Properties as any).DeadLetterConfig.TargetArn).toBeDefined();
  });
});

describe("lambda/addFunctionUrl", () => {
  it("creates a function URL with NONE auth", () => {
    const template = synthTest(() => {
      const fn = makeLambda("UrlFn");
      addFunctionUrl(fn, "NONE");
    });

    const urls = resourceOfType(template, "AWS::Lambda::Url");
    expect(urls.length).toBe(1);
    expect((urls[0].Properties as any).AuthType).toBe("NONE");

    // Should also create a public invoke permission
    const permissions = resourceOfType(template, "AWS::Lambda::Permission");
    expect(permissions.length).toBe(1);
  });

  it("creates a function URL with AWS_IAM auth (no permission)", () => {
    const template = synthTest(() => {
      const fn = makeLambda("IamUrlFn");
      addFunctionUrl(fn, "AWS_IAM");
    });

    const urls = resourceOfType(template, "AWS::Lambda::Url");
    expect(urls.length).toBe(1);
    expect((urls[0].Properties as any).AuthType).toBe("AWS_IAM");

    // No public invoke permission for IAM auth
    const permissions = resourceOfType(template, "AWS::Lambda::Permission");
    expect(permissions.length).toBe(0);
  });

  it("supports CORS configuration", () => {
    const template = synthTest(() => {
      const fn = makeLambda("CorsFn");
      addFunctionUrl(fn, "NONE", {
        allowOrigins: ["https://example.com"],
        allowMethods: ["GET", "POST"],
        maxAge: 86400,
      });
    });

    const urls = resourceOfType(template, "AWS::Lambda::Url");
    expect((urls[0].Properties as any).Cors.AllowOrigins).toEqual(["https://example.com"]);
  });
});

describe("lambda/setLogRetention", () => {
  it("creates a log group with retention", () => {
    const template = synthTest(() => {
      const fn = makeLambda("LogFn");
      setLogRetention(fn, 7);
    });

    const logGroups = resourceOfType(template, "AWS::Logs::LogGroup");
    expect(logGroups.length).toBe(1);
    expect((logGroups[0].Properties as any).RetentionInDays).toBe(7);
  });
});

// ==========================================================================
// SQS boxes
// ==========================================================================

