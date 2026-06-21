import { describe, expect, it } from "vitest";
import { resourceOfType, synthTest } from "../src/testing/index.js";
import { mkQueue } from "../src/generated/sqs.js";
import { mkTopic } from "../src/generated/sns.js";
import { mkSecurityGroup, mkSubnet, mkVPC } from "../src/generated/ec2.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import {
  addTopicPolicy,
  subscribeEmail,
  subscribeLambda,
  subscribeQueue,
  subscribeUrl,
  subscriptionDLQ,
} from "../src/boxes/sns.js";
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


describe("sns/subscribeLambda", () => {
  it("creates subscription and permission", () => {
    const template = synthTest(() => {
      const topic = mkTopic("Events", {});
      const fn = makeLambda("Handler");
      subscribeLambda(topic, fn);
    });

    const subs = resourceOfType(template, "AWS::SNS::Subscription");
    expect(subs.length).toBe(1);
    expect((subs[0].Properties as any).Protocol).toBe("lambda");

    const perms = resourceOfType(template, "AWS::Lambda::Permission");
    expect(perms.length).toBe(1);
    expect((perms[0].Properties as any).Principal).toBe("sns.amazonaws.com");
  });

  it("applies filter policy if provided", () => {
    const template = synthTest(() => {
      const topic = mkTopic("Filtered", {});
      const fn = makeLambda("FilterFn");
      subscribeLambda(topic, fn, { eventType: ["order.created"] });
    });

    const subs = resourceOfType(template, "AWS::SNS::Subscription");
    // filterPolicy gets PascalCased at the key level: filterPolicy -> FilterPolicy
    // The content is the raw object (keys inside are user-supplied, get PascalCased too)
    const filterPolicy = (subs[0].Properties as any).FilterPolicy;
    expect(filterPolicy).toBeDefined();
    // The user-supplied key "eventType" becomes "EventType" after PascalCase conversion
    expect(filterPolicy.EventType).toEqual(["order.created"]);
  });
});

describe("sns/subscribeQueue", () => {
  it("creates subscription and queue policy", () => {
    const template = synthTest(() => {
      const topic = mkTopic("QTopic", {});
      const queue = mkQueue("SubQueue", {});
      subscribeQueue(topic, queue);
    });

    const subs = resourceOfType(template, "AWS::SNS::Subscription");
    expect(subs.length).toBe(1);
    expect((subs[0].Properties as any).Protocol).toBe("sqs");
    expect((subs[0].Properties as any).RawMessageDelivery).toBe(true);

    const queuePolicies = resourceOfType(template, "AWS::SQS::QueuePolicy");
    expect(queuePolicies.length).toBe(1);
  });
});

describe("sns/subscribeUrl", () => {
  it("creates an HTTPS subscription", () => {
    const template = synthTest(() => {
      const topic = mkTopic("UrlTopic", {});
      subscribeUrl(topic, "https://hooks.example.com/notify");
    });

    const subs = resourceOfType(template, "AWS::SNS::Subscription");
    expect(subs.length).toBe(1);
    expect((subs[0].Properties as any).Protocol).toBe("https");
    expect((subs[0].Properties as any).Endpoint).toBe("https://hooks.example.com/notify");
  });

  it("creates an HTTP subscription for http URLs", () => {
    const template = synthTest(() => {
      const topic = mkTopic("HttpTopic", {});
      subscribeUrl(topic, "http://internal.example.com/webhook");
    });

    const subs = resourceOfType(template, "AWS::SNS::Subscription");
    expect((subs[0].Properties as any).Protocol).toBe("http");
  });
});

describe("sns/subscribeEmail", () => {
  it("creates an email subscription", () => {
    const template = synthTest(() => {
      const topic = mkTopic("EmailTopic", {});
      subscribeEmail(topic, "alerts@example.com");
    });

    const subs = resourceOfType(template, "AWS::SNS::Subscription");
    expect(subs.length).toBe(1);
    expect((subs[0].Properties as any).Protocol).toBe("email");
    expect((subs[0].Properties as any).Endpoint).toBe("alerts@example.com");
  });
});

describe("sns/subscriptionDLQ", () => {
  it("creates a lambda subscription with redrive policy", () => {
    const template = synthTest(() => {
      const topic = mkTopic("DlqTopic", {});
      const fn = makeLambda("DlqHandler");
      const dlq = mkQueue("SubDLQ", {});
      subscriptionDLQ(topic, fn, dlq);
    });

    const subs = resourceOfType(template, "AWS::SNS::Subscription");
    expect(subs.length).toBe(1);
    expect((subs[0].Properties as any).Protocol).toBe("lambda");
    expect((subs[0].Properties as any).RedrivePolicy).toBeDefined();

    const perms = resourceOfType(template, "AWS::Lambda::Permission");
    expect(perms.length).toBe(1);
  });
});

describe("sns/addTopicPolicy", () => {
  it("creates a topic policy resource", () => {
    const template = synthTest(() => {
      const topic = mkTopic("PolicyTopic", {});
      addTopicPolicy(topic, {
        effect: "Allow",
        principal: { Service: "s3.amazonaws.com" },
        action: "SNS:Publish",
      });
    });

    const policies = resourceOfType(template, "AWS::SNS::TopicPolicy");
    expect(policies.length).toBe(1);
    expect((policies[0].Properties as any).PolicyDocument.Statement[0].Principal).toEqual({ Service: "s3.amazonaws.com" });
  });
});

// ==========================================================================
// DynamoDB boxes
// ==========================================================================

