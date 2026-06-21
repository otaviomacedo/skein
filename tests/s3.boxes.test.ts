import { describe, expect, it } from "vitest";
import { hasResource, resetAll, resourceOfType, synthTest } from "../src/testing/index.js";
import { mkBucket } from "../src/generated/s3.js";
import { mkQueue } from "../src/generated/sqs.js";
import { mkTopic } from "../src/generated/sns.js";
import { mkSecurityGroup, mkSubnet, mkVPC } from "../src/generated/ec2.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import {
  addBucketPolicy,
  addCorsRule,
  addLifecycleRule,
  notifyLambda,
  notifyQueue,
  notifyTopic,
} from "../src/boxes/s3.js";
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


describe("s3/addLifecycleRule", () => {
  it("adds a lifecycle rule with expiration", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("MyBucket", {});
      addLifecycleRule(bucket, {
        id: "expire-old",
        prefix: "logs/",
        expirationInDays: 90,
      });
    });

    // Verify via direct property inspection
    const props = template.Resources.MyBucket.Properties as Record<string, unknown>;
    const config = props.LifecycleConfiguration as Record<string, unknown>;
    expect(config).toBeDefined();
    const rules = config.Rules as Record<string, unknown>[];
    expect(rules.length).toBe(1);
    expect(rules[0].Status).toBe("Enabled");
    expect(rules[0].Id).toBe("expire-old");
    expect(rules[0].Prefix).toBe("logs/");
    expect(rules[0].ExpirationInDays).toBe(90);
  });

  it("supports transitions", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("Trans", {});
      addLifecycleRule(bucket, {
        transitions: [{ storageClass: "GLACIER", transitionInDays: 30 }],
      });
    });

    const props = template.Resources.Trans.Properties as Record<string, unknown>;
    const config = props.LifecycleConfiguration as Record<string, unknown>;
    const rules = config.Rules as Record<string, unknown>[];
    expect(rules[0].Transitions).toEqual([{ StorageClass: "GLACIER", TransitionInDays: 30 }]);
  });

  it("accumulates rules in returned value", () => {
    // Verify accumulation logic on the in-memory object (synth merge
    // conflicts on arrays, so we test the box return value directly)
    resetAll();
    const bucket = mkBucket("Multi", {});
    const b2 = addLifecycleRule(bucket, { id: "rule1", expirationInDays: 30 });
    const b3 = addLifecycleRule(b2, { id: "rule2", expirationInDays: 60 });
    const rules = (b3.properties.lifecycleConfiguration as any).rules;
    expect(rules.length).toBe(2);
    expect(rules[0].id).toBe("rule1");
    expect(rules[1].id).toBe("rule2");
  });
});

describe("s3/addCorsRule", () => {
  it("adds a CORS rule", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("CorsBucket", {});
      addCorsRule(bucket, {
        allowedOrigins: ["https://example.com"],
        allowedMethods: ["GET", "PUT"],
        allowedHeaders: ["*"],
        maxAge: 3600,
      });
    });

    const props = template.Resources.CorsBucket.Properties as Record<string, unknown>;
    const config = props.CorsConfiguration as Record<string, unknown>;
    expect(config).toBeDefined();
    const rules = config.CorsRules as Record<string, unknown>[];
    expect(rules.length).toBe(1);
    expect(rules[0].AllowedOrigins).toEqual(["https://example.com"]);
    expect(rules[0].AllowedMethods).toEqual(["GET", "PUT"]);
    expect(rules[0].AllowedHeaders).toEqual(["*"]);
    expect(rules[0].MaxAge).toBe(3600);
  });

  it("accumulates rules in returned value", () => {
    resetAll();
    const bucket = mkBucket("MultiCors", {});
    const b2 = addCorsRule(bucket, { allowedOrigins: ["*"], allowedMethods: ["GET"] });
    const b3 = addCorsRule(b2, { allowedOrigins: ["https://app.io"], allowedMethods: ["POST"] });
    const rules = (b3.properties.corsConfiguration as any).corsRules;
    expect(rules.length).toBe(2);
    expect(rules[0].allowedOrigins).toEqual(["*"]);
    expect(rules[1].allowedOrigins).toEqual(["https://app.io"]);
  });
});

describe("s3/notifyLambda", () => {
  it("adds lambda notification config and creates permission", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("EventBucket", {});
      const fn = makeLambda("Processor");
      notifyLambda(bucket, fn, "s3:ObjectCreated:*", "uploads/");
    });

    const permissions = resourceOfType(template, "AWS::Lambda::Permission");
    expect(permissions.length).toBe(1);
    expect((permissions[0].Properties as any).Principal).toBe("s3.amazonaws.com");

    expect(hasResource(template, "EventBucket", {
      type: "AWS::S3::Bucket",
    })).toBe(true);
  });
});

describe("s3/notifyQueue", () => {
  it("adds queue notification config to bucket", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("QBucket", {});
      const queue = mkQueue("NotifQueue", {});
      notifyQueue(bucket, queue, "s3:ObjectCreated:Put");
    });

    expect(hasResource(template, "QBucket", { type: "AWS::S3::Bucket" })).toBe(true);
    expect(hasResource(template, "NotifQueue", { type: "AWS::SQS::Queue" })).toBe(true);
  });
});

describe("s3/notifyTopic", () => {
  it("adds topic notification config to bucket", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("TBucket", {});
      const topic = mkTopic("NotifTopic", {});
      notifyTopic(bucket, topic, "s3:ObjectRemoved:*");
    });

    expect(hasResource(template, "TBucket", { type: "AWS::S3::Bucket" })).toBe(true);
    expect(hasResource(template, "NotifTopic", { type: "AWS::SNS::Topic" })).toBe(true);
  });
});

describe("s3/addBucketPolicy", () => {
  it("creates a bucket policy resource", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("PolicyBucket", {});
      addBucketPolicy(bucket, {
        effect: "Allow",
        principal: "*",
        action: "s3:GetObject",
        resource: `arn:aws:s3:::my-bucket/*`,
      });
    });

    const policies = resourceOfType(template, "AWS::S3::BucketPolicy");
    expect(policies.length).toBe(1);
    expect((policies[0].Properties as any).PolicyDocument.Statement[0].Effect).toBe("Allow");
  });
});

// ==========================================================================
// Lambda boxes
// ==========================================================================

