import { mkRole } from "../generated/iam.js";
import { mkLambdaFunction, LambdaFunction, LambdaFunctionProps } from "../generated/lambda.js";
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

    return mkLambdaFunction(logicalId, { ...fnProps, role } as LambdaFunctionProps);
  },
);
