import type { Function } from "../lib/lambda.js";
import type { Topic, Subscription, TopicPolicy } from "../generated/sns.js";
import { mkSubscription, mkTopicPolicy } from "../generated/sns.js";
import type { Queue } from "../generated/sqs.js";
import { mkQueuePolicy } from "../generated/sqs.js";
import type { QueuePolicy } from "../generated/sqs.js";
import { mkPermission } from "../generated/lambda.js";
import type { LambdaFunction } from "../generated/lambda.js";
import type { Policy } from "../generated/iam.js";
import { mkPolicy } from "../generated/iam.js";
import { ref, deriveId } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

/**
 * Grants a Lambda function permission to publish messages to an SNS topic.
 */
export const grantPublish = box(
  "grantPublish",
  (fn: Function, topic: Topic): [Function, Topic, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, topic, "PublishPolicy"), {
      policyName: deriveId(role, topic, "PublishPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: "sns:Publish",
          Resource: [topic.topicArn],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, topic, policy];
  },
);

// === Subscriptions ===

export type FilterPolicy = Record<string, unknown>;

/**
 * Subscribes a single Lambda function to the topic.
 * Creates the Subscription and a Lambda Permission allowing SNS to invoke it.
 */
export const subscribeLambda = box(
  "subscribeLambda",
  (topic: Topic, fn: LambdaFunction, filter?: FilterPolicy): [Topic, Subscription] => {
    const sub = mkSubscription(deriveId(topic, fn, "Sub"), {
      topicArn: topic,
      protocol: "lambda",
      endpoint: fn.arn,
      ...(filter && { filterPolicy: filter }),
    });

    mkPermission(deriveId(topic, fn, "InvokePermission"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "sns.amazonaws.com",
      sourceArn: topic.topicArn,
    });

    return [topic, sub];
  },
);

/**
 * Subscribes an SQS queue to the topic.
 * Creates the Subscription and a QueuePolicy allowing SNS to send messages.
 */
export const subscribeQueue = box(
  "subscribeQueue",
  (topic: Topic, queue: Queue, filter?: FilterPolicy): [Topic, Queue, Subscription, QueuePolicy] => {
    const sub = mkSubscription(deriveId(topic, queue, "Sub"), {
      topicArn: topic,
      protocol: "sqs",
      endpoint: queue.arn,
      rawMessageDelivery: true,
      ...(filter && { filterPolicy: filter }),
    });

    const queuePolicy = mkQueuePolicy(deriveId(topic, queue, "SendPolicy"), {
      queues: [ref(queue)],
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "sns.amazonaws.com" },
          Action: "sqs:SendMessage",
          Resource: queue.arn,
          Condition: {
            ArnEquals: { "aws:SourceArn": topic.topicArn },
          },
        }],
      },
    });

    return [topic, queue, sub, queuePolicy];
  },
);

/**
 * Subscribes an HTTP/HTTPS endpoint to the topic.
 */
export const subscribeUrl = box(
  "subscribeUrl",
  (topic: Topic, url: string, filter?: FilterPolicy): [Topic, Subscription] => {
    const protocol = url.startsWith("https") ? "https" : "http";
    const sub = mkSubscription(deriveId(topic, url.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20), "Sub"), {
      topicArn: topic,
      protocol,
      endpoint: url,
      ...(filter && { filterPolicy: filter }),
    });
    return [topic, sub];
  },
);

/**
 * Subscribes an email address to the topic.
 */
export const subscribeEmail = box(
  "subscribeEmail",
  (topic: Topic, email: string): [Topic, Subscription] => {
    const sub = mkSubscription(deriveId(topic, email.replace(/[^a-zA-Z0-9]/g, ""), "Sub"), {
      topicArn: topic,
      protocol: "email",
      endpoint: email,
    });
    return [topic, sub];
  },
);

// === Subscription DLQ ===

/**
 * Attaches a dead-letter queue to a subscription for failed delivery handling.
 */
export const subscriptionDLQ = box(
  "subscriptionDLQ",
  (topic: Topic, fn: LambdaFunction, dlq: Queue, filter?: FilterPolicy): [Topic, Subscription] => {
    const sub = mkSubscription(deriveId(topic, fn, "SubWithDLQ"), {
      topicArn: topic,
      protocol: "lambda",
      endpoint: fn.arn,
      redrivePolicy: { deadLetterTargetArn: dlq.arn },
      ...(filter && { filterPolicy: filter }),
    });

    mkPermission(deriveId(topic, fn, "DLQInvokePermission"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "sns.amazonaws.com",
      sourceArn: topic.topicArn,
    });

    return [topic, sub];
  },
);

// === Topic policy ===

export type TopicPolicyStatement = {
  effect: "Allow" | "Deny";
  principal: string | { Service?: string; AWS?: string | string[] } | "*";
  action: string | string[];
  condition?: Record<string, Record<string, string>>;
};

/**
 * Attaches a resource-based policy to the topic. Commonly used to allow
 * other AWS accounts or services (S3, CloudWatch) to publish to the topic.
 */
export const addTopicPolicy = box(
  "addTopicPolicy",
  (topic: Topic, ...statements: TopicPolicyStatement[]): [Topic, TopicPolicy] => {
    const policy = mkTopicPolicy(deriveId(topic, "Policy"), {
      topics: [ref(topic)],
      policyDocument: {
        Version: "2012-10-17",
        Statement: statements.map((s) => ({
          Effect: s.effect,
          Principal: s.principal,
          Action: s.action,
          Resource: topic.topicArn,
          ...(s.condition && { Condition: s.condition }),
        })),
      },
    });
    return [topic, policy];
  },
);
