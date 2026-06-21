import type { Function } from "../lib/lambda.js";
import type { Url } from "../generated/lambda.js";
import { mkUrl, mkPermission } from "../generated/lambda.js";
import type { Queue } from "../generated/sqs.js";
import type { Subnet, SecurityGroup } from "../generated/ec2.js";
import { mkLogGroup } from "../generated/logs.js";
import type { LogGroup } from "../generated/logs.js";
import { updateResource } from "../runtime/registry.js";
import { ref, deriveId } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

export const addEnvironment = box(
  "addEnvironment",
  (fn: Function, key: string, value: string): Function => {
    const existing = fn.properties.environment?.variables ?? {};
    const properties = {
      ...fn.properties,
      environment: {
        variables: { ...existing, [key]: value },
      },
    };
    updateResource(fn.logicalId, fn.__type, properties);
    return { ...fn, properties } as Function;
  },
);


// === Layers ===

/**
 * Attaches one or more layer ARNs to the function. Layers provide shared
 * code/libraries without bundling them into every deployment package.
 */
export const addLayers = box(
  "addLayers",
  (fn: Function, ...layerArns: string[]): Function => {
    const existing = (fn.properties as any).layers ?? [];
    const properties = {
      ...fn.properties,
      layers: [...existing, ...layerArns],
    };
    updateResource(fn.logicalId, fn.__type, properties);
    return { ...fn, properties } as Function;
  },
);

// === VPC ===

/**
 * Places the function inside a VPC, allowing it to access resources like
 * RDS, ElastiCache, or other VPC-bound services.
 */
export const setVpc = box(
  "setVpc",
  (fn: Function, subnets: readonly Subnet[], securityGroups: readonly SecurityGroup[]): Function => {
    const properties = {
      ...fn.properties,
      vpcConfig: {
        subnetIds: subnets.map((s) => s.subnetId),
        securityGroupIds: securityGroups.map((sg) => sg.groupId),
      },
    };
    updateResource(fn.logicalId, fn.__type, properties);
    return { ...fn, properties } as Function;
  },
);

// === Dead letter queue ===

/**
 * Configures a dead letter queue for async invocation failures.
 * When the function fails to process an async event after retries,
 * the event is sent to the specified SQS queue.
 */
export const setDeadLetterQueue = box(
  "setDeadLetterQueue",
  (fn: Function, queue: Queue): [Function, Queue] => {
    const properties = {
      ...fn.properties,
      deadLetterConfig: {
        targetArn: queue.arn,
      },
    };
    updateResource(fn.logicalId, fn.__type, properties);
    return [{ ...fn, properties } as Function, queue];
  },
);

// === Function URL ===

export type FunctionUrlAuth = "NONE" | "AWS_IAM";

export type FunctionUrlCors = {
  allowOrigins?: string[];
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: number;
  allowCredentials?: boolean;
};

/**
 * Creates a public HTTPS endpoint for the function — no API Gateway needed.
 * Returns the function and the URL resource (which has .functionUrl).
 */
export const addFunctionUrl = box(
  "addFunctionUrl",
  (fn: Function, authType: FunctionUrlAuth = "NONE", cors?: FunctionUrlCors): [Function, Url] => {
    const urlProps: any = {
      targetFunctionArn: fn,
      authType,
    };
    if (cors) {
      urlProps.cors = {
        allowOrigins: cors.allowOrigins,
        allowMethods: cors.allowMethods,
        allowHeaders: cors.allowHeaders,
        exposeHeaders: cors.exposeHeaders,
        maxAge: cors.maxAge,
        allowCredentials: cors.allowCredentials,
      };
    }

    const url = mkUrl(deriveId(fn, "Url"), urlProps);

    // If auth is NONE, add a resource-based policy allowing public invoke
    if (authType === "NONE") {
      mkPermission(deriveId(fn, "UrlPublicInvoke"), {
        functionName: ref(fn),
        action: "lambda:InvokeFunctionUrl",
        principal: "*",
        functionUrlAuthType: "NONE",
      });
    }

    return [fn, url];
  },
);

// === Log retention ===

/**
 * Creates a CloudWatch Log Group for the function with a specified retention
 * period. Without this, Lambda creates a log group with infinite retention.
 */
export const setLogRetention = box(
  "setLogRetention",
  (fn: Function, retentionInDays: number): [Function, LogGroup] => {
    const logGroup = mkLogGroup(deriveId(fn, "Logs"), {
      logGroupName: `/aws/lambda/${ref(fn)}`,
      retentionInDays,
    });
    return [fn, logGroup];
  },
);

