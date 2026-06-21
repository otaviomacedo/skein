import { describe, expect, it } from "vitest";
import { hasResource, resourceOfType, synthTest } from "../src/testing/index.js";
import { mkQueue } from "../src/generated/sqs.js";
import { mkSecurityGroup, mkSubnet, mkVPC } from "../src/generated/ec2.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import { addQueuePolicy, grantConsumeMessages, setRedriveAllowPolicy, } from "../src/boxes/sqs.js";
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


describe("sqs/addQueuePolicy", () => {
  it("creates a queue policy", () => {
    const template = synthTest(() => {
      const queue = mkQueue("MyQueue", {});
      addQueuePolicy(queue, {
        effect: "Allow",
        principal: { Service: "sns.amazonaws.com" },
        action: "sqs:SendMessage",
      });
    });

    const policies = resourceOfType(template, "AWS::SQS::QueuePolicy");
    expect(policies.length).toBe(1);
    expect((policies[0].Properties as any).PolicyDocument.Statement[0].Effect).toBe("Allow");
  });
});

describe("sqs/setRedriveAllowPolicy", () => {
  it("sets allowAll redrive policy", () => {
    const template = synthTest(() => {
      const dlq = mkQueue("DLQ", {});
      setRedriveAllowPolicy(dlq, "allowAll");
    });

    // redriveAllowPolicy is in OPAQUE_JSON_KEYS so inner values stay camelCase
    expect(hasResource(template, "DLQ", {
      type: "AWS::SQS::Queue",
      properties: { RedriveAllowPolicy: { redrivePermission: "allowAll" } },
    })).toBe(true);
  });

  it("sets denyAll redrive policy", () => {
    const template = synthTest(() => {
      const dlq = mkQueue("DenyDLQ", {});
      setRedriveAllowPolicy(dlq, "denyAll");
    });

    expect(hasResource(template, "DenyDLQ", {
      type: "AWS::SQS::Queue",
      properties: { RedriveAllowPolicy: { redrivePermission: "denyAll" } },
    })).toBe(true);
  });

  it("sets byQueue redrive policy with source queues", () => {
    const template = synthTest(() => {
      const dlq = mkQueue("ByQDLQ", {});
      const source1 = mkQueue("Source1", {});
      const source2 = mkQueue("Source2", {});
      setRedriveAllowPolicy(dlq, [source1, source2]);
    });

    expect(hasResource(template, "ByQDLQ", {
      type: "AWS::SQS::Queue",
      properties: { RedriveAllowPolicy: { redrivePermission: "byQueue" } },
    })).toBe(true);
  });
});

describe("sqs/grantConsumeMessages", () => {
  it("creates an IAM policy with full consume permissions", () => {
    const template = synthTest(() => {
      const fn = makeLambda("Consumer");
      const queue = mkQueue("WorkQueue", {});
      grantConsumeMessages(fn, queue);
    });

    const policies = resourceOfType(template, "AWS::IAM::Policy");
    expect(policies.length).toBe(1);
    const statement = (policies[0].Properties as any).PolicyDocument.Statement[0];
    expect(statement.Action).toContain("sqs:ReceiveMessage");
    expect(statement.Action).toContain("sqs:DeleteMessage");
    expect(statement.Action).toContain("sqs:ChangeMessageVisibility");
    expect(statement.Action).toContain("sqs:PurgeQueue");
  });
});

// ==========================================================================
// SNS boxes
// ==========================================================================

