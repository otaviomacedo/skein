import type { Function } from "../lib/lambda.js";
import type { Table } from "../generated/dynamodb.js";
import { mkPolicy } from "../generated/iam.js";
import type { Policy } from "../generated/iam.js";
import { mkEventSourceMapping } from "../generated/lambda.js";
import type { EventSourceMapping } from "../generated/lambda.js";
import { makeResource, ref, deriveId } from "../runtime/resource.js";
import { updateResource, addDependency } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export const grantTableRead = box(
  "grantTableRead",
  (fn: Function, table: Table): [Function, Table, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, table, "ReadPolicy"), {
      policyName: deriveId(role, table, "ReadPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:BatchGetItem",
          ],
          Resource: [
            table.arn,
            `${table.arn}/index/*`,
          ],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, table, policy];
  },
);

export const grantTableReadWrite = box(
  "grantTableReadWrite",
  (fn: Function, table: Table): [Function, Table, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, table, "ReadWritePolicy"), {
      policyName: deriveId(role, table, "ReadWritePolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:BatchGetItem",
            "dynamodb:BatchWriteItem",
          ],
          Resource: [
            table.arn,
            `${table.arn}/index/*`,
          ],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, table, policy];
  },
);

// === Global Secondary Indexes ===

export type GSIDefinition = {
  indexName: string;
  partitionKey: { name: string; type: "S" | "N" | "B" };
  sortKey?: { name: string; type: "S" | "N" | "B" };
  projection?: "ALL" | "KEYS_ONLY" | string[];
};

/**
 * Adds a Global Secondary Index to the table. Creates the GSI definition
 * and ensures the required attribute definitions are present.
 * Can be called multiple times to add multiple GSIs.
 */
export const addGSI = box(
  "addGSI",
  (table: Table, gsi: GSIDefinition): Table => {
    const existingGSIs = (table.properties as any).globalSecondaryIndexes ?? [];
    const existingAttrs = (table.properties as any).attributeDefinitions ?? [];

    const keySchema = [
      { attributeName: gsi.partitionKey.name, keyType: "HASH" },
      ...(gsi.sortKey ? [{ attributeName: gsi.sortKey.name, keyType: "RANGE" }] : []),
    ];

    let projection: Record<string, unknown>;
    if (!gsi.projection || gsi.projection === "ALL") {
      projection = { projectionType: "ALL" };
    } else if (gsi.projection === "KEYS_ONLY") {
      projection = { projectionType: "KEYS_ONLY" };
    } else {
      projection = { projectionType: "INCLUDE", nonKeyAttributes: gsi.projection };
    }

    const newGSI = { indexName: gsi.indexName, keySchema, projection };

    // Add attribute definitions if not already present
    const attrNames = new Set(existingAttrs.map((a: any) => a.attributeName));
    const newAttrs = [...existingAttrs];
    if (!attrNames.has(gsi.partitionKey.name)) {
      newAttrs.push({ attributeName: gsi.partitionKey.name, attributeType: gsi.partitionKey.type });
    }
    if (gsi.sortKey && !attrNames.has(gsi.sortKey.name)) {
      newAttrs.push({ attributeName: gsi.sortKey.name, attributeType: gsi.sortKey.type });
    }

    const properties = {
      ...table.properties,
      globalSecondaryIndexes: [...existingGSIs, newGSI],
      attributeDefinitions: newAttrs,
    };
    updateResource(table.logicalId, table.__type, properties);
    return { ...table, properties } as Table;
  },
);

// === DynamoDB Streams ===

export type StreamViewType = "NEW_IMAGE" | "OLD_IMAGE" | "NEW_AND_OLD_IMAGES" | "KEYS_ONLY";

/**
 * Enables DynamoDB Streams on the table and wires a Lambda function to
 * process stream records. Creates the stream specification, an
 * EventSourceMapping, and an IAM policy for stream access.
 */
export const streamToLambda = box(
  "streamToLambda",
  (table: Table, fn: Function, viewType: StreamViewType = "NEW_AND_OLD_IMAGES", batchSize: number = 100): [Table, Function, EventSourceMapping, Policy] => {
    // Enable stream on the table
    const properties = {
      ...table.properties,
      streamSpecification: { streamViewType: viewType },
    };
    updateResource(table.logicalId, table.__type, properties);

    // Grant stream read permissions
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, table, "StreamReadPolicy"), {
      policyName: deriveId(role, table, "StreamReadPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "dynamodb:GetRecords",
            "dynamodb:GetShardIterator",
            "dynamodb:DescribeStream",
            "dynamodb:ListStreams",
          ],
          Resource: [table.streamArn],
        }],
      },
      roles: [ref(role)],
    });

    // Create event source mapping
    const mappingId = deriveId(fn, table, "StreamTrigger");
    const mapping = mkEventSourceMapping(mappingId, {
      eventSourceArn: table.streamArn,
      functionName: ref(fn),
      batchSize,
      startingPosition: "LATEST",
      enabled: true,
    } as any);

    addDependency(mappingId, policy.logicalId);

    return [{ ...table, properties } as Table, fn, mapping, policy];
  },
);

// === Grant stream read ===

/**
 * Grants a Lambda function permission to read from the table's DynamoDB Stream.
 * Does NOT enable the stream — the table must already have a stream enabled.
 */
export const grantStreamRead = box(
  "grantStreamRead",
  (fn: Function, table: Table): [Function, Table, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, table, "StreamReadPolicy"), {
      policyName: deriveId(role, table, "StreamReadPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "dynamodb:GetRecords",
            "dynamodb:GetShardIterator",
            "dynamodb:DescribeStream",
            "dynamodb:ListStreams",
          ],
          Resource: [table.streamArn],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, table, policy];
  },
);

// === Auto-scaling ===

export type AutoScalingConfig = {
  minCapacity: number;
  maxCapacity: number;
  targetUtilization: number;
};

/**
 * Adds auto-scaling to a table's read capacity. Creates a ScalableTarget
 * and a TargetTrackingScalingPolicy.
 */
export const autoScaleReadCapacity = box(
  "autoScaleReadCapacity",
  (table: Table, config: AutoScalingConfig): Table => {
    const targetId = deriveId(table, "ReadScaleTarget");
    makeResource("AWS::ApplicationAutoScaling::ScalableTarget", targetId, {
      serviceNamespace: "dynamodb",
      resourceId: `table/${ref(table)}`,
      scalableDimension: "dynamodb:table:ReadCapacityUnits",
      minCapacity: config.minCapacity,
      maxCapacity: config.maxCapacity,
    });

    makeResource("AWS::ApplicationAutoScaling::ScalingPolicy", deriveId(table, "ReadScalePolicy"), {
      policyName: deriveId(table, "ReadScalePolicy"),
      policyType: "TargetTrackingScaling",
      scalingTargetId: ref({ __type: "AWS::ApplicationAutoScaling::ScalableTarget", logicalId: targetId, properties: {} }),
      targetTrackingScalingPolicyConfiguration: {
        targetValue: config.targetUtilization,
        predefinedMetricSpecification: {
          predefinedMetricType: "DynamoDBReadCapacityUtilization",
        },
      },
    });

    return table;
  },
);

/**
 * Adds auto-scaling to a table's write capacity. Creates a ScalableTarget
 * and a TargetTrackingScalingPolicy.
 */
export const autoScaleWriteCapacity = box(
  "autoScaleWriteCapacity",
  (table: Table, config: AutoScalingConfig): Table => {
    const targetId = deriveId(table, "WriteScaleTarget");
    makeResource("AWS::ApplicationAutoScaling::ScalableTarget", targetId, {
      serviceNamespace: "dynamodb",
      resourceId: `table/${ref(table)}`,
      scalableDimension: "dynamodb:table:WriteCapacityUnits",
      minCapacity: config.minCapacity,
      maxCapacity: config.maxCapacity,
    });

    makeResource("AWS::ApplicationAutoScaling::ScalingPolicy", deriveId(table, "WriteScalePolicy"), {
      policyName: deriveId(table, "WriteScalePolicy"),
      policyType: "TargetTrackingScaling",
      scalingTargetId: ref({ __type: "AWS::ApplicationAutoScaling::ScalableTarget", logicalId: targetId, properties: {} }),
      targetTrackingScalingPolicyConfiguration: {
        targetValue: config.targetUtilization,
        predefinedMetricSpecification: {
          predefinedMetricType: "DynamoDBWriteCapacityUtilization",
        },
      },
    });

    return table;
  },
);
