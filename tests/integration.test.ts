import { describe, it, expect, beforeEach } from "vitest";
import { resetTokens } from "../src/runtime/tokens";
import { resetRegistry } from "../src/runtime/registry";
import { synth } from "../src/runtime/synth";
import { mkBucket } from "../src/generated/s3";
import { mkRole } from "../src/generated/iam";
import { mkFunction } from "../src/lib/lambda";
import { encrypt, enableVersioning, enableWebHosting, blockPublicAccess } from "../src/boxes/s3";
import { grantRead, grantWrite } from "../src/boxes/iam";

function reset() {
  resetTokens();
  resetRegistry();
}

describe("integration: static site with Lambda deployer", () => {
  beforeEach(reset);

  it("composes boxes into a valid template", () => {
    // Top-level generators
    const contentBucket = mkBucket("ContentBucket", {});
    const role = mkRole("DeployerRole", {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
          Action: "sts:AssumeRole",
        }],
      },
    });
    const fn = mkFunction("Deployer", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code-bucket", s3Key: "deployer.zip" },
      role,
    });

    // Compose transformers
    const contentBucket2 = enableWebHosting(blockPublicAccess(encrypt(enableVersioning(contentBucket))));

    // Wire permissions
    const [fn2, contentBucket3, readPolicy] = grantRead(fn, contentBucket2);
    const [fn3, contentBucket4, writePolicy] = grantWrite(fn, contentBucket2);

    // Synth
    const template = synth();

    // Verify resources exist
    expect(Object.keys(template.Resources)).toHaveLength(5); // bucket, role, function, 2 policies

    // Verify bucket has all transformer properties merged
    const bucketProps = template.Resources.ContentBucket.Properties as Record<string, unknown>;
    expect(bucketProps.versioningConfiguration).toEqual({ status: "Enabled" });
    expect(bucketProps.bucketEncryption).toBeDefined();
    expect(bucketProps.websiteConfiguration).toEqual({
      indexDocument: "index.html",
      errorDocument: "error.html",
    });
    expect(bucketProps.publicAccessBlockConfiguration).toEqual({
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });

    // Verify function references role
    const fnProps = template.Resources.Deployer.Properties as Record<string, unknown>;
    expect(fnProps.role).toEqual({ "Fn::GetAtt": ["DeployerRole", "Arn"] });

    // Verify policies reference both bucket and role
    const readPolicyId = "DeployerRoleContentBucketReadPolicy";
    const writePolicyId = "DeployerRoleContentBucketWritePolicy";
    expect(template.Resources[readPolicyId]).toBeDefined();
    expect(template.Resources[writePolicyId]).toBeDefined();

    const readPolicyProps = template.Resources[readPolicyId].Properties as Record<string, unknown>;
    expect(readPolicyProps.roles).toEqual([{ Ref: "DeployerRole" }]);

    // Verify DependsOn
    expect(template.Resources.Deployer.DependsOn).toContain("DeployerRole");
    expect(template.Resources[readPolicyId].DependsOn).toContain("DeployerRole");
    expect(template.Resources[readPolicyId].DependsOn).toContain("ContentBucket");
  });

  it("sequential transformers compose correctly", () => {
    const bucket = mkBucket("B", {});
    const b2 = encrypt(bucket);
    const b3 = enableVersioning(b2);
    const b4 = enableWebHosting(b3);

    const template = synth();
    const props = template.Resources.B.Properties as Record<string, unknown>;

    expect(props.bucketEncryption).toBeDefined();
    expect(props.versioningConfiguration).toEqual({ status: "Enabled" });
    expect(props.websiteConfiguration).toBeDefined();
  });

  it("typed references are accessible through resource properties", () => {
    const role = mkRole("MyRole", {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
      },
    });
    const fn = mkFunction("MyFunc", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code", s3Key: "fn.zip" },
      role,
    });

    // User can access the role directly from the function
    expect(fn.role).toBe(role);
    expect(fn.role.logicalId).toBe("MyRole");
    expect(fn.role.properties.assumeRolePolicyDocument).toBeDefined();

    // And it resolves correctly in the template
    const template = synth();
    const fnProps = template.Resources.MyFunc.Properties as Record<string, unknown>;
    expect(fnProps.role).toEqual({ "Fn::GetAtt": ["MyRole", "Arn"] });
  });

  it("parallel grants create independent policies", () => {
    const bucket1 = mkBucket("Bucket1", {});
    const bucket2 = mkBucket("Bucket2", {});
    const role = mkRole("Role", {
      assumeRolePolicyDocument: { Version: "2012-10-17", Statement: [] },
    });
    const fn = mkFunction("Fn", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code", s3Key: "fn.zip" },
      role,
    });

    // Parallel grants — both read from fn (no modification to fn itself)
    const [, , policy1] = grantRead(fn, bucket1);
    const [, , policy2] = grantWrite(fn, bucket2);

    const template = synth();

    // Both policies should exist independently
    expect(template.Resources["RoleBucket1ReadPolicy"]).toBeDefined();
    expect(template.Resources["RoleBucket2WritePolicy"]).toBeDefined();

    // 4 resources: 2 buckets + role + function + 2 policies = 6
    expect(Object.keys(template.Resources)).toHaveLength(6);
  });
});
