import type { Topic } from "../generated/sns.js";
import { mkSubscription } from "../generated/sns.js";
import type { Subscription } from "../generated/sns.js";
import { mkPermission } from "../generated/lambda.js";
import type { LambdaFunction } from "../generated/lambda.js";
import { ref, deriveId } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

export type FanoutSubscription = {
  readonly fn: LambdaFunction;
  readonly subscription: Subscription;
};

export type Fanout = {
  readonly subscriptions: readonly FanoutSubscription[];
};

/**
 * Subscribes multiple Lambda functions to an SNS topic (fan-out pattern).
 *
 * For each handler, creates an SNS Subscription (protocol: lambda) and a
 * Lambda Permission allowing SNS to invoke the function.
 */
export const snsFanout = box(
  "snsFanout",
  (topic: Topic, handlers: LambdaFunction[]): Fanout => {
    const subscriptions: FanoutSubscription[] = [];

    for (const fn of handlers) {
      const subscription = mkSubscription(deriveId(topic, fn, "Sub"), {
        topicArn: topic,
        protocol: "lambda",
        endpoint: fn.arn,
      });

      mkPermission(deriveId(topic, fn, "InvokePermission"), {
        functionName: ref(fn),
        action: "lambda:InvokeFunction",
        principal: "sns.amazonaws.com",
        sourceArn: topic.topicArn,
      });

      subscriptions.push({ fn, subscription });
    }

    return { subscriptions };
  },
);