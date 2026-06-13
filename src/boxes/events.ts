import { Function } from "../lib/lambda.js";
import { Rule, mkRule, getRuleAtt } from "../generated/events.js";
import { Permission, mkPermission } from "../generated/lambda.js";
import { ref, deriveId, getAtt } from "../runtime/resource.js";
import { box } from "../runtime/box.js";
import { getLambdaFunctionAtt } from "../generated/lambda.js";

export const onSchedule = box(
  "onSchedule",
  (fn: Function, schedule: string): [Function, Rule] => {
    const rule = mkRule(deriveId(fn, "ScheduleRule"), {
      scheduleExpression: schedule,
      state: "ENABLED",
      targets: [{
        id: fn.logicalId,
        arn: getLambdaFunctionAtt(fn, "Arn"),
      }],
    });

    mkPermission(deriveId(fn, rule, "InvokePermission"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "events.amazonaws.com",
      sourceArn: getRuleAtt(rule, "Arn"),
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
        arn: getLambdaFunctionAtt(fn, "Arn"),
      }],
    });

    mkPermission(deriveId(fn, rule, "InvokePermission"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "events.amazonaws.com",
      sourceArn: getRuleAtt(rule, "Arn"),
    });

    return [fn, rule];
  },
);
