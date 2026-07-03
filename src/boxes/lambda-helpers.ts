import { mkRole, mkPolicy } from "../generated/iam.js";
import { mkLambdaFunction } from "../generated/lambda.js";
import type { LambdaFunction, LambdaFunctionProps } from "../generated/lambda.js";
import { ref } from "../runtime/resource.js";
import { box } from "../runtime/box.js";

export type SimpleFunctionProps = Omit<LambdaFunctionProps, "role"> & {
  roleName?: string;
  managedPolicies?: string[];
};

export const mkLambda = box(
  "mkLambda",
  (logicalId: string, props: SimpleFunctionProps): LambdaFunction => {
    const roleName = props.roleName ?? `${logicalId}Role`;
    const { managedPolicies, roleName: _, ...fnProps } = props;

    const role = mkRole(roleName, {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
          Action: "sts:AssumeRole",
        }],
      },
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ...(managedPolicies ?? []),
      ] as any,
    });

    if (props.code.s3Bucket) {
      mkPolicy(`${logicalId}CodeAccessPolicy`, {
        policyName: `${logicalId}CodeAccessPolicy`,
        policyDocument: {
          Version: "2012-10-17",
          Statement: [{
            Effect: "Allow",
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${props.code.s3Bucket}/${props.code.s3Key}`],
          }],
        },
        roles: [ref(role)],
      });
    }

    return mkLambdaFunction(logicalId, { ...fnProps, role } as LambdaFunctionProps);
  },
);
