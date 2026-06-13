import { Function } from "../lib/lambda.js";
import { Bucket, getBucketAtt } from "../generated/s3.js";
import { Policy, mkPolicy, Role } from "../generated/iam.js";
import { ref, deriveId } from "../runtime/resource.js";
import { updateResource } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export const grantRead = box(
  "grantRead",
  (fn: Function, bucket: Bucket): [Function, Bucket, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, bucket, "ReadPolicy"), {
      policyName: deriveId(role, bucket, "ReadPolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:GetBucketLocation", "s3:ListBucket"],
          Resource: [
            getBucketAtt(bucket, "Arn"),
            `${getBucketAtt(bucket, "Arn")}/*`,
          ],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, bucket, policy];
  },
);

export const grantWrite = box(
  "grantWrite",
  (fn: Function, bucket: Bucket): [Function, Bucket, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, bucket, "WritePolicy"), {
      policyName: deriveId(role, bucket, "WritePolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: ["s3:PutObject", "s3:DeleteObject"],
          Resource: [
            `${getBucketAtt(bucket, "Arn")}/*`,
          ],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, bucket, policy];
  },
);

export const grantReadWrite = box(
  "grantReadWrite",
  (fn: Function, bucket: Bucket): [Function, Bucket, Policy] => {
    const role = fn.role;
    const policy = mkPolicy(deriveId(role, bucket, "ReadWritePolicy"), {
      policyName: deriveId(role, bucket, "ReadWritePolicy"),
      policyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "s3:GetObject",
            "s3:GetBucketLocation",
            "s3:ListBucket",
            "s3:PutObject",
            "s3:DeleteObject",
          ],
          Resource: [
            getBucketAtt(bucket, "Arn"),
            `${getBucketAtt(bucket, "Arn")}/*`,
          ],
        }],
      },
      roles: [ref(role)],
    });
    return [fn, bucket, policy];
  },
);

export const addManagedPolicy = box(
  "addManagedPolicy",
  (role: Role, policyArn: string): Role => {
    const existing = role.properties.managedPolicyArns ?? [];
    const properties = {
      ...role.properties,
      managedPolicyArns: [...existing, policyArn],
    };
    updateResource(role.logicalId, role.__type, properties);
    return { ...role, properties };
  },
);
