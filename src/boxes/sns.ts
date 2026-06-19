import type { Function } from "../lib/lambda.js";
import type { Topic } from "../generated/sns.js";
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
