import type { Function } from "../lib/lambda.js";
import type { StateMachine } from "../generated/stepfunctions.js";
import { mkPolicy } from "../generated/iam.js";
import type { Policy } from "../generated/iam.js";
import { ref, deriveId } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

/**
 * Grants a Lambda function permission to start executions of a Step Functions
 * state machine. Attaches a policy to the function's role.
 */
export const grantStartExecution = box(
  "grantStartExecution",
  (fn: Function, stateMachine: StateMachine): [Function, StateMachine, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, stateMachine, "StartExecPolicy"), {
      policyName: deriveId(role, stateMachine, "StartExecPolicy"),
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
    return [fn, stateMachine, policy];
  },
);
