import type { Bucket, BucketPolicy } from "../generated/s3.js";
import { mkBucketPolicy } from "../generated/s3.js";
import type { LambdaFunction } from "../generated/lambda.js";
import { mkPermission } from "../generated/lambda.js";
import type { Queue } from "../generated/sqs.js";
import type { Topic } from "../generated/sns.js";
import { updateResource } from "../runtime/registry.js";
import { ref, deriveId } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

// === Convenience transformers ===
// These set properties that could also be passed at construction time.
// They exist for ergonomics in pipe() chains and as pedagogical examples.

export const encrypt = box("encrypt", (bucket: Bucket, algorithm: string = "AES256"): Bucket => {
  const properties = {
    ...bucket.properties,
    bucketEncryption: {
      serverSideEncryptionConfiguration: [{
        serverSideEncryptionByDefault: { sseAlgorithm: algorithm },
      }],
    },
  };
  updateResource(bucket.logicalId, bucket.__type, properties);
  return { ...bucket, properties };
});

export const enableVersioning = box("enableVersioning", (bucket: Bucket): Bucket => {
  const properties = {
    ...bucket.properties,
    versioningConfiguration: { status: "Enabled" },
  };
  updateResource(bucket.logicalId, bucket.__type, properties);
  return { ...bucket, properties };
});

export const enableWebHosting = box(
  "enableWebHosting",
  (bucket: Bucket, indexDoc: string = "index.html", errorDoc: string = "error.html"): Bucket => {
    const properties = {
      ...bucket.properties,
      websiteConfiguration: { indexDocument: indexDoc, errorDocument: errorDoc },
    };
    updateResource(bucket.logicalId, bucket.__type, properties);
    return { ...bucket, properties };
  },
);

export const enableLogDelivery = box("enableLogDelivery", (bucket: Bucket): Bucket => {
  const properties = {
    ...bucket.properties,
    ownershipControls: {
      rules: [{ objectOwnership: "BucketOwnerPreferred" }],
    },
  };
  updateResource(bucket.logicalId, bucket.__type, properties);
  return { ...bucket, properties };
});

export const blockPublicAccess = box("blockPublicAccess", (bucket: Bucket): Bucket => {
  const properties = {
    ...bucket.properties,
    publicAccessBlockConfiguration: {
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    },
  };
  updateResource(bucket.logicalId, bucket.__type, properties);
  return { ...bucket, properties };
});

// === Lifecycle rules ===

export type LifecycleRule = {
  id?: string;
  prefix?: string;
  enabled?: boolean;
  expirationInDays?: number;
  transitions?: { storageClass: string; transitionInDays: number }[];
  noncurrentVersionExpirationInDays?: number;
  abortIncompleteMultipartUploadDays?: number;
};

/**
 * Adds a lifecycle rule to the bucket. Multiple rules can be added by
 * calling this box multiple times — they accumulate (mergeable collection).
 */
export const addLifecycleRule = box(
  "addLifecycleRule",
  (bucket: Bucket, rule: LifecycleRule): Bucket => {
    const existing = (bucket.properties.lifecycleConfiguration as any)?.rules ?? [];
    const cfnRule: Record<string, unknown> = {
      status: rule.enabled !== false ? "Enabled" : "Disabled",
    };
    if (rule.id) cfnRule.id = rule.id;
    if (rule.prefix !== undefined) cfnRule.prefix = rule.prefix;
    if (rule.expirationInDays) cfnRule.expirationInDays = rule.expirationInDays;
    if (rule.noncurrentVersionExpirationInDays) {
      cfnRule.noncurrentVersionExpirationInDays = rule.noncurrentVersionExpirationInDays;
    }
    if (rule.abortIncompleteMultipartUploadDays) {
      cfnRule.abortIncompleteMultipartUpload = {
        daysAfterInitiation: rule.abortIncompleteMultipartUploadDays,
      };
    }
    if (rule.transitions) {
      cfnRule.transitions = rule.transitions.map((t) => ({
        storageClass: t.storageClass,
        transitionInDays: t.transitionInDays,
      }));
    }

    const properties = {
      ...bucket.properties,
      lifecycleConfiguration: {
        rules: [...existing, cfnRule],
      },
    };
    updateResource(bucket.logicalId, bucket.__type, properties);
    return { ...bucket, properties };
  },
);

// === CORS ===

export type CorsRule = {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAge?: number;
};

/**
 * Adds a CORS rule to the bucket. Multiple rules can be added by
 * calling this box multiple times.
 */
export const addCorsRule = box(
  "addCorsRule",
  (bucket: Bucket, rule: CorsRule): Bucket => {
    const existing = (bucket.properties.corsConfiguration as any)?.corsRules ?? [];
    const cfnRule: Record<string, unknown> = {
      allowedOrigins: rule.allowedOrigins,
      allowedMethods: rule.allowedMethods,
    };
    if (rule.allowedHeaders) cfnRule.allowedHeaders = rule.allowedHeaders;
    if (rule.exposedHeaders) cfnRule.exposedHeaders = rule.exposedHeaders;
    if (rule.maxAge !== undefined) cfnRule.maxAge = rule.maxAge;

    const properties = {
      ...bucket.properties,
      corsConfiguration: {
        corsRules: [...existing, cfnRule],
      },
    };
    updateResource(bucket.logicalId, bucket.__type, properties);
    return { ...bucket, properties };
  },
);

// === Event notifications ===

export type S3EventType =
  | "s3:ObjectCreated:*"
  | "s3:ObjectCreated:Put"
  | "s3:ObjectCreated:Post"
  | "s3:ObjectCreated:Copy"
  | "s3:ObjectRemoved:*"
  | "s3:ObjectRemoved:Delete"
  | "s3:ObjectRestore:Post"
  | "s3:ObjectRestore:Completed"
  | "s3:ReducedRedundancyLostObject"
  | string;

/**
 * Triggers a Lambda function on bucket events. Creates a Lambda Permission
 * allowing S3 to invoke the function.
 */
export const notifyLambda = box(
  "notifyLambda",
  (bucket: Bucket, fn: LambdaFunction, event: S3EventType, prefix?: string): [Bucket, LambdaFunction] => {
    const existing = (bucket.properties.notificationConfiguration as any)?.lambdaConfigurations ?? [];

    const config: Record<string, unknown> = {
      function: fn.arn,
      event,
    };
    if (prefix) {
      config.filter = { s3Key: { rules: [{ name: "prefix", value: prefix }] } };
    }

    const properties = {
      ...bucket.properties,
      notificationConfiguration: {
        ...(bucket.properties.notificationConfiguration as object ?? {}),
        lambdaConfigurations: [...existing, config],
      },
    };
    updateResource(bucket.logicalId, bucket.__type, properties);

    mkPermission(deriveId(bucket, fn, "S3Invoke"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "s3.amazonaws.com",
      sourceArn: bucket.arn,
    });

    return [{ ...bucket, properties } as Bucket, fn];
  },
);

/**
 * Sends notifications to an SQS queue on bucket events.
 */
export const notifyQueue = box(
  "notifyQueue",
  (bucket: Bucket, queue: Queue, event: S3EventType, prefix?: string): [Bucket, Queue] => {
    const existing = (bucket.properties.notificationConfiguration as any)?.queueConfigurations ?? [];

    const config: Record<string, unknown> = {
      queue: queue.arn,
      event,
    };
    if (prefix) {
      config.filter = { s3Key: { rules: [{ name: "prefix", value: prefix }] } };
    }

    const properties = {
      ...bucket.properties,
      notificationConfiguration: {
        ...(bucket.properties.notificationConfiguration as object ?? {}),
        queueConfigurations: [...existing, config],
      },
    };
    updateResource(bucket.logicalId, bucket.__type, properties);
    return [{ ...bucket, properties } as Bucket, queue];
  },
);

/**
 * Sends notifications to an SNS topic on bucket events.
 */
export const notifyTopic = box(
  "notifyTopic",
  (bucket: Bucket, topic: Topic, event: S3EventType, prefix?: string): [Bucket, Topic] => {
    const existing = (bucket.properties.notificationConfiguration as any)?.topicConfigurations ?? [];

    const config: Record<string, unknown> = {
      topic: topic.topicArn,
      event,
    };
    if (prefix) {
      config.filter = { s3Key: { rules: [{ name: "prefix", value: prefix }] } };
    }

    const properties = {
      ...bucket.properties,
      notificationConfiguration: {
        ...(bucket.properties.notificationConfiguration as object ?? {}),
        topicConfigurations: [...existing, config],
      },
    };
    updateResource(bucket.logicalId, bucket.__type, properties);
    return [{ ...bucket, properties } as Bucket, topic];
  },
);

// === Bucket policy ===

export type PolicyStatement = {
  effect: "Allow" | "Deny";
  principal: string | { Service?: string; AWS?: string | string[] } | "*";
  action: string | string[];
  resource: string | string[];
  condition?: Record<string, Record<string, string>>;
};

/**
 * Attaches a resource policy to the bucket. Accepts one or more IAM
 * policy statements.
 */
export const addBucketPolicy = box(
  "addBucketPolicy",
  (bucket: Bucket, ...statements: PolicyStatement[]): [Bucket, BucketPolicy] => {
    const policy = mkBucketPolicy(deriveId(bucket, "Policy"), {
      bucket: ref(bucket),
      policyDocument: {
        Version: "2012-10-17",
        Statement: statements.map((s) => ({
          Effect: s.effect,
          Principal: s.principal,
          Action: s.action,
          Resource: s.resource,
          ...(s.condition && { Condition: s.condition }),
        })),
      },
    });
    return [bucket, policy];
  },
);
