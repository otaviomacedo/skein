import type { Function } from "../lib/lambda.js";
import type { Queue } from "../generated/sqs.js";
import { mkPolicy } from "../generated/iam.js";
import type { Policy, Role } from "../generated/iam.js";
import { mkEventSourceMapping } from "../generated/lambda.js";
import type { EventSourceMapping } from "../generated/lambda.js";
import { deriveId, ref } from "../runtime/resource.js";
import { updateResource, addDependency } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export const grantSendMessage = box(
  "grantSendMessage",
  (fn: Function, queue: Queue): [Function, Queue, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, queue, "SendPolicy"), {
      policyName: deriveId(role, queue, "SendPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: ["sqs:SendMessage", "sqs:GetQueueUrl"],
          Resource: [queue.arn],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, queue, policy];
  },
);

export const triggerFromQueue = box(
  "triggerFromQueue",
  (fn: Function, queue: Queue, batchSize: number = 10): [Function, Queue, EventSourceMapping, Policy] => {
    const role = fn.role;

    const policy = mkPolicy(deriveId(role, queue, "ConsumePolicy"), {
      policyName: deriveId(role, queue, "ConsumePolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes",
          ],
          Resource: [queue.arn],
        }],
      },
      roles: [ref(role)],
    });

    const mappingId = deriveId(fn, queue, "Trigger");
    const mapping = mkEventSourceMapping(mappingId, {
      eventSourceArn: queue.arn,
      functionName: ref(fn),
      batchSize,
      enabled: true,
    });

    addDependency(mappingId, policy.logicalId);

    return [fn, queue, mapping, policy];
  },
);

export const withDLQ = box(
  "withDLQ",
  (queue: Queue, dlq: Queue, maxReceiveCount: number): [Queue, Queue] => {
    const properties = {
      ...queue.properties,
      redrivePolicy: {
        deadLetterTargetArn: dlq.arn,
        maxReceiveCount,
      },
    };
    updateResource(queue.logicalId, queue.__type, properties);
    return [{ ...queue, properties } as Queue, dlq];
  },
);


// === Queue policy ===

import { mkQueuePolicy } from "../generated/sqs.js";
import type { QueuePolicy } from "../generated/sqs.js";

export type QueuePolicyStatement = {
  effect: "Allow" | "Deny";
  principal: string | { Service?: string; AWS?: string | string[] } | "*";
  action: string | string[];
  condition?: Record<string, Record<string, string>>;
};

/**
 * Attaches a resource-based policy to the queue. Commonly used to allow
 * S3, SNS, or other services to send messages to the queue.
 */
export const addQueuePolicy = box(
  "addQueuePolicy",
  (queue: Queue, ...statements: QueuePolicyStatement[]): [Queue, QueuePolicy] => {
    const policy = mkQueuePolicy(deriveId(queue, "Policy"), {
      queues: [ref(queue)],
      policyDocument: {
        Version: "2012-10-17",
        Statement: statements.map((s) => ({
          Effect: s.effect,
          Principal: s.principal,
          Action: s.action,
          Resource: queue.arn,
          ...(s.condition && { Condition: s.condition }),
        })),
      },
    });
    return [queue, policy];
  },
);

// === Redrive allow policy ===

/**
 * Sets the redrive allow policy, controlling which source queues can use
 * this queue as their dead-letter queue.
 */
export const setRedriveAllowPolicy = box(
  "setRedriveAllowPolicy",
  (queue: Queue, sourceQueues: Queue[] | "allowAll" | "denyAll"): Queue => {
    let redriveAllowPolicy: Record<string, unknown>;
    if (sourceQueues === "allowAll") {
      redriveAllowPolicy = { redrivePermission: "allowAll" };
    } else if (sourceQueues === "denyAll") {
      redriveAllowPolicy = { redrivePermission: "denyAll" };
    } else {
      redriveAllowPolicy = {
        redrivePermission: "byQueue",
        sourceQueueArns: sourceQueues.map((q) => q.arn),
      };
    }
    const properties = { ...queue.properties, redriveAllowPolicy };
    updateResource(queue.logicalId, queue.__type, properties);
    return { ...queue, properties } as Queue;
  },
);

// === Grant consume ===

/**
 * Grants a Lambda function full consume permissions (receive, delete,
 * get attributes, change visibility). More permissive than triggerFromQueue
 * (which only grants the minimum for event source mappings).
 */
export const grantConsumeMessages = box(
  "grantConsumeMessages",
  (fn: Function, queue: Queue): [Function, Queue, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, queue, "ConsumeFullPolicy"), {
      policyName: deriveId(role, queue, "ConsumeFullPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
            "sqs:ChangeMessageVisibility",
            "sqs:PurgeQueue",
          ],
          Resource: [queue.arn],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, queue, policy];
  },
);
