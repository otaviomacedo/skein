import { describe, it, expect } from "vitest";
import { synthTest, hasResource, resourceOfType } from "../src/testing/index.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import { mkQueue } from "../src/generated/sqs.js";
import { mkTopic } from "../src/generated/sns.js";
import { mkEventRule, addLambdaTarget, addQueueTarget, addTopicTarget, addStepFunctionsTarget } from "../src/boxes/events.js";
import { stepFunctionsPipeline } from "../src/boxes/step-functions.js";
import { pipe } from "../src/boxes/pipe.js";

const fnProps = { runtime: "nodejs20.x", handler: "index.handler", code: { s3Bucket: "b", s3Key: "k" } };

describe("events/mkEventRule", () => {
  it("creates a rule with an event pattern", () => {
    const template = synthTest(() => {
      mkEventRule("OrderEvents", {
        pattern: { source: ["my.app"], "detail-type": ["OrderCreated"] },
      });
    });

    expect(hasResource(template, "OrderEvents", { type: "AWS::Events::Rule" })).toBe(true);
  });

  it("creates a rule with a schedule", () => {
    const template = synthTest(() => {
      mkEventRule("DailyCleanup", {
        schedule: "rate(1 day)",
        description: "Clean up old records",
      });
    });

    expect(hasResource(template, "DailyCleanup", { type: "AWS::Events::Rule" })).toBe(true);
  });
});

describe("events/addLambdaTarget", () => {
  it("adds a Lambda target and creates a permission", () => {
    const template = synthTest(() => {
      const rule = mkEventRule("MyRule", { pattern: { source: ["app"] } });
      const fn = mkLambda("Handler", fnProps);
      addLambdaTarget(rule, fn);
    });

    const permissions = resourceOfType(template, "AWS::Lambda::Permission");
    expect(permissions.length).toBe(1);

    const rules = resourceOfType(template, "AWS::Events::Rule");
    expect(rules.length).toBe(1);
    const targets = (rules[0].Properties as any).Targets;
    expect(targets.length).toBe(1);
  });

  it("accumulates multiple Lambda targets on the same rule", () => {
    const template = synthTest(() => {
      const rule = mkEventRule("FanRule", { pattern: { source: ["app"] } });
      const fn1 = mkLambda("Handler1", fnProps);
      const fn2 = mkLambda("Handler2", fnProps);
      const [rule2] = addLambdaTarget(rule, fn1);
      addLambdaTarget(rule2, fn2);
    });

    const permissions = resourceOfType(template, "AWS::Lambda::Permission");
    expect(permissions.length).toBe(2);

    const rules = resourceOfType(template, "AWS::Events::Rule");
    const targets = (rules[0].Properties as any).Targets;
    expect(targets.length).toBe(2);
  });
});

describe("events/addQueueTarget", () => {
  it("adds an SQS target and creates a queue policy", () => {
    const template = synthTest(() => {
      const rule = mkEventRule("Ingest", { pattern: { source: ["partner"] } });
      const queue = mkQueue("IngestQueue", {});
      addQueueTarget(rule, queue);
    });

    const queuePolicies = resourceOfType(template, "AWS::SQS::QueuePolicy");
    expect(queuePolicies.length).toBe(1);

    const rules = resourceOfType(template, "AWS::Events::Rule");
    const targets = (rules[0].Properties as any).Targets;
    expect(targets.length).toBe(1);
  });
});

describe("events/addTopicTarget", () => {
  it("adds an SNS topic target", () => {
    const template = synthTest(() => {
      const rule = mkEventRule("Notify", { schedule: "rate(5 minutes)" });
      const topic = mkTopic("Alerts", {});
      addTopicTarget(rule, topic);
    });

    const rules = resourceOfType(template, "AWS::Events::Rule");
    const targets = (rules[0].Properties as any).Targets;
    expect(targets.length).toBe(1);
  });
});

describe("events/addStepFunctionsTarget", () => {
  it("adds a Step Functions target with IAM role and policy", () => {
    const template = synthTest(() => {
      const fn = mkLambda("Step", fnProps);
      const { stateMachine } = stepFunctionsPipeline("Workflow", {
        steps: [{ name: "DoWork", fn }],
      });
      const rule = mkEventRule("TriggerWorkflow", { pattern: { source: ["app"] } });
      addStepFunctionsTarget(rule, stateMachine);
    });

    // Should have a role for EventBridge to start the execution
    const roles = resourceOfType(template, "AWS::IAM::Role");
    const eventRole = roles.find((r) => (r.Properties as any).AssumeRolePolicyDocument?.Statement?.[0]?.Principal?.Service === "events.amazonaws.com");
    expect(eventRole).toBeDefined();

    // Should have an IAM policy granting states:StartExecution
    const policies = resourceOfType(template, "AWS::IAM::Policy");
    const startExecPolicy = policies.find((p) => {
      const statements = (p.Properties as any).PolicyDocument?.Statement ?? [];
      return statements.some((s: any) => s.Action === "states:StartExecution");
    });
    expect(startExecPolicy).toBeDefined();

    // Rule should have the target
    const rules = resourceOfType(template, "AWS::Events::Rule");
    const targets = (rules[0].Properties as any).Targets;
    expect(targets.length).toBe(1);
  });
});

describe("events/target options", () => {
  it("supports input transformer", () => {
    const template = synthTest(() => {
      const rule = mkEventRule("Transform", { pattern: { source: ["app"] } });
      const fn = mkLambda("Fn", fnProps);
      addLambdaTarget(rule, fn, {
        inputTransformer: { inputPathsMap: { id: "$.detail.id" }, inputTemplate: '{"orderId": <id>}' },
      });
    });

    const rules = resourceOfType(template, "AWS::Events::Rule");
    const target = (rules[0].Properties as any).Targets[0];
    expect(target.InputTransformer).toBeDefined();
    expect(target.InputTransformer.InputTemplate).toBe('{"orderId": <id>}');
  });

  it("supports dead letter queue on target", () => {
    const template = synthTest(() => {
      const rule = mkEventRule("Reliable", { pattern: { source: ["app"] } });
      const fn = mkLambda("Fn", fnProps);
      const dlq = mkQueue("DLQ", {});
      addLambdaTarget(rule, fn, { deadLetterQueue: dlq });
    });

    const rules = resourceOfType(template, "AWS::Events::Rule");
    const target = (rules[0].Properties as any).Targets[0];
    expect(target.DeadLetterConfig).toBeDefined();
  });

  it("supports retry policy", () => {
    const template = synthTest(() => {
      const rule = mkEventRule("Retry", { pattern: { source: ["app"] } });
      const queue = mkQueue("Q", {});
      addQueueTarget(rule, queue, { retryPolicy: { maximumRetryAttempts: 5, maximumEventAgeInSeconds: 3600 } });
    });

    const rules = resourceOfType(template, "AWS::Events::Rule");
    const target = (rules[0].Properties as any).Targets[0];
    expect(target.RetryPolicy.MaximumRetryAttempts).toBe(5);
    expect(target.RetryPolicy.MaximumEventAgeInSeconds).toBe(3600);
  });
});

describe("events/multi-target composition", () => {
  it("pipes multiple targets onto a single rule", () => {
    const template = synthTest(() => {
      const rule = mkEventRule("MultiTarget", { pattern: { source: ["orders"] } });
      const fn = mkLambda("Audit", fnProps);
      const queue = mkQueue("Analytics", {});
      const topic = mkTopic("Notify", {});

      pipe(rule)
        .to(addLambdaTarget, fn)
        .to(addQueueTarget, queue)
        .to(addTopicTarget, topic)
        .done();
    });

    const rules = resourceOfType(template, "AWS::Events::Rule");
    const targets = (rules[0].Properties as any).Targets;
    expect(targets.length).toBe(3);

    expect(resourceOfType(template, "AWS::Lambda::Permission").length).toBe(1);
    expect(resourceOfType(template, "AWS::SQS::QueuePolicy").length).toBe(1);
  });
});
