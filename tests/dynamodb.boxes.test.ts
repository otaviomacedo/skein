import { describe, it, expect } from "vitest";
import { synthTest, hasResource, resourceOfType, resetAll } from "../src/testing/index.js";
import { mkBucket } from "../src/generated/s3.js";
import { mkQueue } from "../src/generated/sqs.js";
import { mkTopic } from "../src/generated/sns.js";
import { mkTable } from "../src/generated/dynamodb.js";
import { mkVPC, mkSubnet, mkSecurityGroup, mkRouteTable } from "../src/generated/ec2.js";
import { mkCluster, mkService, mkTaskDefinition } from "../src/generated/ecs.js";
import { mkFileSystem } from "../src/generated/efs.js";
import { mkUserPool } from "../src/generated/cognito.js";
import { mkCertificate } from "../src/generated/certificatemanager.js";
import { mkHostedZone } from "../src/generated/route53.js";
import { mkRole } from "../src/generated/iam.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import {
  addLifecycleRule,
  addCorsRule,
  notifyLambda,
  notifyQueue,
  notifyTopic,
  addBucketPolicy,
} from "../src/boxes/s3.js";
import {
  addLayers,
  setVpc,
  setDeadLetterQueue,
  addFunctionUrl,
  setLogRetention,
} from "../src/boxes/lambda.js";
import {
  addQueuePolicy,
  setRedriveAllowPolicy,
  grantConsumeMessages,
} from "../src/boxes/sqs.js";
import {
  subscribeLambda,
  subscribeQueue,
  subscribeUrl,
  subscribeEmail,
  subscriptionDLQ,
  addTopicPolicy,
} from "../src/boxes/sns.js";
import {
  addGSI,
  streamToLambda,
  grantStreamRead,
  autoScaleReadCapacity,
  autoScaleWriteCapacity,
} from "../src/boxes/dynamodb.js";
import {
  autoScaleService,
  enableServiceDiscovery,
  addSidecar,
  enableCircuitBreaker,
  mountEfs,
  fargateService,
} from "../src/boxes/fargate.js";
import {
  allowFrom,
  allowFromCidr,
  allowTo,
  addGatewayEndpoint,
  addInterfaceEndpoint,
  enableFlowLogs,
  peerVpcs,
} from "../src/boxes/vpc.js";
import {
  mkApi,
  addCognitoAuthorizer,
  addLambdaAuthorizer,
  addUsagePlan,
  addCustomDomain,
} from "../src/boxes/api.js";

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


describe("dynamodb/addGSI", () => {
  it("returns a table with the GSI definition", () => {
    // addGSI modifies the attributeDefinitions array, which causes merge
    // conflicts at synth time. Test the box logic via return value.
    resetAll();
    const table = mkTable("Items", {
      keySchema: [{ attributeName: "pk", keyType: "HASH" }],
      attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
      billingMode: "PAY_PER_REQUEST",
    });
    const result = addGSI(table, {
      indexName: "ByStatus",
      partitionKey: { name: "status", type: "S" },
    });

    const gsis = (result.properties as any).globalSecondaryIndexes;
    expect(gsis.length).toBe(1);
    expect(gsis[0].indexName).toBe("ByStatus");
    expect(gsis[0].keySchema).toEqual([{ attributeName: "status", keyType: "HASH" }]);
    expect(gsis[0].projection).toEqual({ projectionType: "ALL" });

    // Attribute definitions should now include the GSI partition key
    const attrs = (result.properties as any).attributeDefinitions;
    expect(attrs.length).toBe(2);
    expect(attrs[1]).toEqual({ attributeName: "status", attributeType: "S" });
  });

  it("adds a GSI with sort key and KEYS_ONLY projection", () => {
    resetAll();
    const table = mkTable("Orders", {
      keySchema: [{ attributeName: "orderId", keyType: "HASH" }],
      attributeDefinitions: [{ attributeName: "orderId", attributeType: "S" }],
      billingMode: "PAY_PER_REQUEST",
    });
    const result = addGSI(table, {
      indexName: "ByCustomerDate",
      partitionKey: { name: "customerId", type: "S" },
      sortKey: { name: "orderDate", type: "S" },
      projection: "KEYS_ONLY",
    });

    const gsis = (result.properties as any).globalSecondaryIndexes;
    expect(gsis[0].keySchema).toEqual([
      { attributeName: "customerId", keyType: "HASH" },
      { attributeName: "orderDate", keyType: "RANGE" },
    ]);
    expect(gsis[0].projection).toEqual({ projectionType: "KEYS_ONLY" });

    const attrs = (result.properties as any).attributeDefinitions;
    expect(attrs.length).toBe(3); // orderId + customerId + orderDate
  });

  it("accumulates multiple GSIs", () => {
    resetAll();
    let table = mkTable("Multi", {
      keySchema: [{ attributeName: "pk", keyType: "HASH" }],
      attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
      billingMode: "PAY_PER_REQUEST",
    });
    table = addGSI(table, { indexName: "GSI1", partitionKey: { name: "gsi1pk", type: "S" } });
    table = addGSI(table, { indexName: "GSI2", partitionKey: { name: "gsi2pk", type: "N" } });

    const gsis = (table.properties as any).globalSecondaryIndexes;
    expect(gsis.length).toBe(2);
    expect(gsis[0].indexName).toBe("GSI1");
    expect(gsis[1].indexName).toBe("GSI2");
  });
});

describe("dynamodb/streamToLambda", () => {
  it("enables streams and creates ESM and policy", () => {
    const template = synthTest(() => {
      const table = mkTable("StreamTable", {
        keySchema: [{ attributeName: "pk", keyType: "HASH" }],
        attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
        billingMode: "PAY_PER_REQUEST",
      });
      const fn = makeLambda("StreamProcessor");
      streamToLambda(table, fn);
    });

    // Table should have stream enabled
    expect(hasResource(template, "StreamTable", {
      type: "AWS::DynamoDB::Table",
      properties: {
        StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
      },
    })).toBe(true);

    // ESM should be created
    const esms = resourceOfType(template, "AWS::Lambda::EventSourceMapping");
    expect(esms.length).toBe(1);
    expect((esms[0].Properties as any).BatchSize).toBe(100);
    expect((esms[0].Properties as any).StartingPosition).toBe("LATEST");

    // IAM policy for stream read
    const policies = resourceOfType(template, "AWS::IAM::Policy");
    expect(policies.length).toBe(1);
    const actions = (policies[0].Properties as any).PolicyDocument.Statement[0].Action;
    expect(actions).toContain("dynamodb:GetRecords");
  });

  it("uses custom viewType and batchSize", () => {
    const template = synthTest(() => {
      const table = mkTable("CustomStream", {
        keySchema: [{ attributeName: "pk", keyType: "HASH" }],
        attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
        billingMode: "PAY_PER_REQUEST",
      });
      const fn = makeLambda("CustomProc");
      streamToLambda(table, fn, "KEYS_ONLY", 25);
    });

    expect(hasResource(template, "CustomStream", {
      type: "AWS::DynamoDB::Table",
      properties: {
        StreamSpecification: { StreamViewType: "KEYS_ONLY" },
      },
    })).toBe(true);

    const esms = resourceOfType(template, "AWS::Lambda::EventSourceMapping");
    expect((esms[0].Properties as any).BatchSize).toBe(25);
  });
});

describe("dynamodb/grantStreamRead", () => {
  it("creates stream read policy", () => {
    const template = synthTest(() => {
      const table = mkTable("ReadTable", {
        keySchema: [{ attributeName: "pk", keyType: "HASH" }],
        attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
        billingMode: "PAY_PER_REQUEST",
      });
      const fn = makeLambda("Reader");
      grantStreamRead(fn, table);
    });

    const policies = resourceOfType(template, "AWS::IAM::Policy");
    expect(policies.length).toBe(1);
    const actions = (policies[0].Properties as any).PolicyDocument.Statement[0].Action;
    expect(actions).toContain("dynamodb:GetRecords");
    expect(actions).toContain("dynamodb:DescribeStream");
  });
});

describe("dynamodb/autoScaleReadCapacity", () => {
  it("creates scalable target and scaling policy", () => {
    const template = synthTest(() => {
      const table = mkTable("ScaleTable", {
        keySchema: [{ attributeName: "pk", keyType: "HASH" }],
        attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
        billingMode: "PROVISIONED",
        provisionedThroughput: { readCapacityUnits: 5, writeCapacityUnits: 5 },
      });
      autoScaleReadCapacity(table, { minCapacity: 5, maxCapacity: 100, targetUtilization: 70 });
    });

    const targets = resourceOfType(template, "AWS::ApplicationAutoScaling::ScalableTarget");
    expect(targets.length).toBe(1);
    expect((targets[0].Properties as any).ScalableDimension).toBe("dynamodb:table:ReadCapacityUnits");

    const policies = resourceOfType(template, "AWS::ApplicationAutoScaling::ScalingPolicy");
    expect(policies.length).toBe(1);
    expect((policies[0].Properties as any).TargetTrackingScalingPolicyConfiguration.TargetValue).toBe(70);
  });
});

describe("dynamodb/autoScaleWriteCapacity", () => {
  it("creates write scalable target and scaling policy", () => {
    const template = synthTest(() => {
      const table = mkTable("WriteScale", {
        keySchema: [{ attributeName: "pk", keyType: "HASH" }],
        attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
        billingMode: "PROVISIONED",
        provisionedThroughput: { readCapacityUnits: 5, writeCapacityUnits: 5 },
      });
      autoScaleWriteCapacity(table, { minCapacity: 5, maxCapacity: 200, targetUtilization: 80 });
    });

    const targets = resourceOfType(template, "AWS::ApplicationAutoScaling::ScalableTarget");
    expect(targets.length).toBe(1);
    expect((targets[0].Properties as any).ScalableDimension).toBe("dynamodb:table:WriteCapacityUnits");
    expect((targets[0].Properties as any).MinCapacity).toBe(5);
    expect((targets[0].Properties as any).MaxCapacity).toBe(200);
  });
});

// ==========================================================================
// Fargate boxes
// ==========================================================================

