import type { Function } from "../lib/lambda.js";
import type { Table } from "../generated/dynamodb.js";
import { mkPolicy } from "../generated/iam.js";
import type { Policy, Role } from "../generated/iam.js";
import { ref, deriveId } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

export const grantTableRead = box(
  "grantTableRead",
  (fn: Function, table: Table): [Function, Table, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, table, "ReadPolicy"), {
      policyName: deriveId(role, table, "ReadPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "dynamodb:GetItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:BatchGetItem",
          ],
          Resource: [
            table.arn,
            `${table.arn}/index/*`,
          ],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, table, policy];
  },
);

export const grantTableReadWrite = box(
  "grantTableReadWrite",
  (fn: Function, table: Table): [Function, Table, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, table, "ReadWritePolicy"), {
      policyName: deriveId(role, table, "ReadWritePolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:BatchGetItem",
            "dynamodb:BatchWriteItem",
          ],
          Resource: [
            table.arn,
            `${table.arn}/index/*`,
          ],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, table, policy];
  },
);
