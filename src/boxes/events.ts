import type { Function } from "../lib/lambda.js";
import { mkRule } from "../generated/events.js";
import type { Rule, EventBus } from "../generated/events.js";
import { mkEventBus } from "../generated/events.js";
import { mkPermission } from "../generated/lambda.js";
import type { LambdaFunction } from "../generated/lambda.js";
import type { Queue } from "../generated/sqs.js";
import { mkQueuePolicy } from "../generated/sqs.js";
import type { Topic } from "../generated/sns.js";
import type { StateMachine } from "../generated/stepfunctions.js";
import { mkRole, mkPolicy } from "../generated/iam.js";
import type { Role } from "../generated/iam.js";
import { ref, deriveId } from "../runtime/resource.js";
import { updateResource } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export const onSchedule = box(
  "onSchedule",
  (fn: Function, schedule: string): [Function, Rule] => {
    const rule = mkRule(deriveId(fn, "ScheduleRule"), {
      scheduleExpression: schedule,
      state: "ENABLED",
      targets: [{
        id: fn.logicalId,
        arn: fn.arn,
      }],
    });

    mkPermission(deriveId(fn, rule, "InvokePermission"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "events.amazonaws.com",
      sourceArn: rule.arn,
    });

    return [fn, rule];
  },
);

export const onEvent = box(
  "onEvent",
  (fn: Function, pattern: Record<string, unknown>): [Function, Rule] => {
    const rule = mkRule(deriveId(fn, "EventRule"), {
      eventPattern: pattern,
      state: "ENABLED",
      targets: [{
        id: fn.logicalId,
        arn: fn.arn,
      }],
    });

    mkPermission(deriveId(fn, rule, "InvokePermission"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "events.amazonaws.com",
      sourceArn: rule.arn,
    });

    return [fn, rule];
  },
);

// === EventBridge Rule builder (multi-target) ===

export type EventRuleProps = {
  pattern?: Record<string, unknown>;
  schedule?: string;
  bus?: EventBus;
  description?: string;
};

/**
 * Creates an EventBridge rule with an event pattern or schedule.
 * Use addLambdaTarget/addQueueTarget/etc. to wire targets.
 */
export const mkEventRule = box(
  "mkEventRule",
  (logicalId: string, props: EventRuleProps): Rule => {
    return mkRule(logicalId, {
      eventPattern: props.pattern,
      scheduleExpression: props.schedule,
      eventBusName: props.bus ? ref(props.bus) : undefined,
      description: props.description,
      state: "ENABLED",
      targets: [],
    });
  },
);

// === Target options ===

export type TargetOptions = {
  inputTransformer?: { inputPathsMap?: Record<string, string>; inputTemplate: string };
  retryPolicy?: { maximumRetryAttempts?: number; maximumEventAgeInSeconds?: number };
  deadLetterQueue?: Queue;
};

function buildTargetConfig(id: string, arn: string, opts?: TargetOptions): Record<string, unknown> {
  const target: Record<string, unknown> = { id, arn };
  if (opts?.inputTransformer) target.inputTransformer = opts.inputTransformer;
  if (opts?.retryPolicy) target.retryPolicy = opts.retryPolicy;
  if (opts?.deadLetterQueue) target.deadLetterConfig = { arn: opts.deadLetterQueue.arn };
  return target;
}

function appendTarget(rule: Rule, target: Record<string, unknown>): Rule {
  // Only push the new target — merge handles concatenation
  const properties = { ...rule.properties, targets: [target] };
  updateResource(rule.logicalId, rule.__type, properties);
  // Return with the accumulated view for in-memory chaining
  const existing = (rule.properties as any).targets ?? [];
  const accumulated = { ...rule.properties, targets: [...existing, target] };
  return { ...rule, properties: accumulated } as Rule;
}

// === Add Lambda target ===

/**
 * Adds a Lambda function as a target of the rule.
 * Creates a Permission allowing EventBridge to invoke the function.
 */
export const addLambdaTarget = box(
  "addLambdaTarget",
  (rule: Rule, fn: LambdaFunction, opts?: TargetOptions): [Rule, LambdaFunction] => {
    const target = buildTargetConfig(fn.logicalId, fn.arn, opts);
    const updatedRule = appendTarget(rule, target);

    mkPermission(deriveId(rule, fn, "InvokePermission"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "events.amazonaws.com",
      sourceArn: rule.arn,
    });

    return [updatedRule, fn];
  },
);

// === Add SQS target ===

/**
 * Adds an SQS queue as a target of the rule.
 * Creates a QueuePolicy allowing EventBridge to send messages.
 */
export const addQueueTarget = box(
  "addQueueTarget",
  (rule: Rule, queue: Queue, opts?: TargetOptions): [Rule, Queue] => {
    const target = buildTargetConfig(queue.logicalId, queue.arn, opts);
    const updatedRule = appendTarget(rule, target);

    mkQueuePolicy(deriveId(rule, queue, "SendPolicy"), {
      queues: [ref(queue)],
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "events.amazonaws.com" },
          Action: "sqs:SendMessage",
          Resource: queue.arn,
          Condition: { ArnEquals: { "aws:SourceArn": rule.arn } },
        }],
      },
    });

    return [updatedRule, queue];
  },
);

// === Add SNS target ===

/**
 * Adds an SNS topic as a target of the rule.
 */
export const addTopicTarget = box(
  "addTopicTarget",
  (rule: Rule, topic: Topic, opts?: TargetOptions): [Rule, Topic] => {
    const target = buildTargetConfig(topic.logicalId, topic.topicArn, opts);
    const updatedRule = appendTarget(rule, target);
    return [updatedRule, topic];
  },
);

// === Add Step Functions target ===

/**
 * Adds a Step Functions state machine as a target of the rule.
 * Creates an IAM role allowing EventBridge to start executions.
 */
export const addStepFunctionsTarget = box(
  "addStepFunctionsTarget",
  (rule: Rule, stateMachine: StateMachine, opts?: TargetOptions): [Rule, StateMachine] => {
    const role = mkRole(deriveId(rule, stateMachine, "EventRole"), {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "events.amazonaws.com" },
          Action: "sts:AssumeRole",
        }],
      },
    });

    mkPolicy(deriveId(rule, stateMachine, "StartExecPolicy"), {
      policyName: deriveId(rule, stateMachine, "StartExecPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: "states:StartExecution",
          Resource: [stateMachine.arn],
        }],
      },
      roles: [ref(role)],
    });

    const target = { ...buildTargetConfig(stateMachine.logicalId, stateMachine.arn, opts), roleArn: role.arn };
    const updatedRule = appendTarget(rule, target);

    return [updatedRule, stateMachine];
  },
);
