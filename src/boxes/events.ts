import { Function } from "../lib/lambda.js";
import { Rule, mkRule } from "../generated/events.js";
import { Permission, mkPermission } from "../generated/lambda.js";
import { ref, deriveId } from "../runtime/resource.js";
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
