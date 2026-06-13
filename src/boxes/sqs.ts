import { Function } from "../lib/lambda.js";
import { Queue, getQueueAtt } from "../generated/sqs.js";
import { Policy, mkPolicy, Role } from "../generated/iam.js";
import { EventSourceMapping, mkEventSourceMapping } from "../generated/lambda.js";
import { deriveId, ref } from "../runtime/resource.js";
import { updateResource } from "../runtime/registry.js";
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
          Resource: [getQueueAtt(queue, "Arn")],
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
          Resource: [getQueueAtt(queue, "Arn")],
        }],
      },
      roles: [ref(role)],
    });

    const mapping = mkEventSourceMapping(deriveId(fn, queue, "Trigger"), {
      eventSourceArn: getQueueAtt(queue, "Arn"),
      functionName: ref(fn),
      batchSize,
      enabled: true,
    });

    return [fn, queue, mapping, policy];
  },
);

export const withDLQ = box(
  "withDLQ",
  (queue: Queue, dlq: Queue, maxReceiveCount: number): [Queue, Queue] => {
    const properties = {
      ...queue.properties,
      redrivePolicy: {
        deadLetterTargetArn: getQueueAtt(dlq, "Arn"),
        maxReceiveCount,
      },
    };
    updateResource(queue.logicalId, queue.__type, properties);
    return [{ ...queue, properties } as Queue, dlq];
  },
);
