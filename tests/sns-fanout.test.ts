import { describe, it, expect } from "vitest";
import { synthTest, hasResource, resourceOfType } from "../src/testing/index.js";
import { mkTopic } from "../src/generated/sns.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import { snsFanout } from "../src/boxes/sns-fanout.js";

describe("snsFanout", () => {
  it("creates a subscription and permission per handler", () => {
    const template = synthTest(() => {
      const topic = mkTopic("OrderEvents", { topicName: "order-events" });

      const emailer = mkLambda("Emailer", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "emailer.zip" },
      });

      const auditor = mkLambda("Auditor", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "auditor.zip" },
      });

      const analytics = mkLambda("Analytics", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "analytics.zip" },
      });

      snsFanout(topic, [emailer, auditor, analytics]);
    });

    const subscriptions = resourceOfType(template, "AWS::SNS::Subscription");
    expect(subscriptions.length).toBe(3);

    const permissions = resourceOfType(template, "AWS::Lambda::Permission");
    expect(permissions.length).toBe(3);

    for (const sub of subscriptions) {
      expect((sub.Properties as any).Protocol).toBe("lambda");
    }
  });

  it("returns subscription references", () => {
    synthTest(() => {
      const topic = mkTopic("Events", {});

      const handler = mkLambda("Handler", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "handler.zip" },
      });

      const result = snsFanout(topic, [handler]);

      expect(result.subscriptions.length).toBe(1);
      expect(result.subscriptions[0].fn.logicalId).toBe("Handler");
      expect(result.subscriptions[0].subscription.logicalId).toContain("Sub");
    });
  });
});