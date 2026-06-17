import { describe, it, expect, beforeEach } from "vitest";
import { resetTokens } from "../src/runtime/tokens";
import { resetRegistry, discard, updateResource } from "../src/runtime/registry";
import { ref, getAtt } from "../src/runtime/resource";
import { synth } from "../src/runtime/synth";
import { mkBucket } from "../src/generated/s3";
import { mkRole, mkPolicy } from "../src/generated/iam";
import { mkFunction } from "../src/lib/lambda";

function reset() {
  resetTokens();
  resetRegistry();
}

describe("synth", () => {
  beforeEach(reset);

  it("produces a template from a single resource", () => {
    mkBucket("MyBucket", { bucketName: "my-bucket" });
    const template = synth();

    expect(template.AWSTemplateFormatVersion).toBe("2010-09-09");
    expect(template.Resources.MyBucket).toEqual({
      Type: "AWS::S3::Bucket",
      Properties: { BucketName: "my-bucket" },
    });
  });

  it("resolves Ref tokens in properties", () => {
    const bucket = mkBucket("MyBucket", {});
    mkPolicy("MyPolicy", {
      policyName: "test",
      policyDocument: {},
      roles: [ref(bucket)],
    });
    const template = synth();

    expect(template.Resources.MyPolicy.Properties).toMatchObject({
      Roles: [{ Ref: "MyBucket" }],
    });
  });

  it("resolves Resource objects in properties via resolution map", () => {
    const role = mkRole("MyRole", {
      assumeRolePolicyDocument: { Version: "2012-10-17", Statement: [] },
    });
    mkFunction("MyFunc", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code", s3Key: "handler.zip" },
      role,
    });
    const template = synth();

    expect(template.Resources.MyFunc.Properties).toMatchObject({
      Role: { "Fn::GetAtt": ["MyRole", "Arn"] },
    });
  });

  it("computes DependsOn from Ref", () => {
    const bucket = mkBucket("Source", {});
    mkPolicy("BucketPolicy", {
      policyName: "policy",
      policyDocument: { bucket: ref(bucket) },
    });
    const template = synth();

    expect(template.Resources.BucketPolicy.DependsOn).toContain("Source");
  });

  it("computes DependsOn from Resource references", () => {
    const role = mkRole("MyRole", {
      assumeRolePolicyDocument: { Version: "2012-10-17", Statement: [] },
    });
    mkFunction("MyFunc", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code", s3Key: "handler.zip" },
      role,
    });
    const template = synth();

    expect(template.Resources.MyFunc.DependsOn).toContain("MyRole");
  });

  it("does not include DependsOn for resources with no dependencies", () => {
    mkBucket("A", {});
    mkBucket("B", {});
    const template = synth();

    expect(template.Resources.A.DependsOn).toBeUndefined();
    expect(template.Resources.B.DependsOn).toBeUndefined();
  });

  it("excludes discarded resources", () => {
    mkBucket("Keep", {});
    mkBucket("Remove", {});
    discard("Remove");
    const template = synth();

    expect(template.Resources.Keep).toBeDefined();
    expect(template.Resources.Remove).toBeUndefined();
  });

  it("throws on broken references", () => {
    const phantom = { __type: "AWS::S3::Bucket", logicalId: "Ghost", properties: {} } as const;
    mkPolicy("MyPolicy", {
      policyName: "test",
      policyDocument: {},
      roles: [ref(phantom)],
    });

    expect(() => synth()).toThrow(/references "Ghost" which does not exist/);
  });

  it("handles string interpolation with tokens", () => {
    const bucket = mkBucket("MyBucket", {});
    const arn = getAtt(bucket, "Arn");
    mkPolicy("MyPolicy", {
      policyName: "test",
      policyDocument: {
        Statement: [{ Resource: `${arn}/*` }],
      },
    });
    const template = synth();

    const resource = (template.Resources.MyPolicy.Properties as Record<string, unknown>)
      .PolicyDocument as Record<string, unknown>;
    const statement = (resource.Statement as unknown[])[0] as Record<string, unknown>;
    expect(statement.Resource).toEqual({
      "Fn::Join": ["", [{ "Fn::GetAtt": ["MyBucket", "Arn"] }, "/*"]],
    });
  });

  it("merges multiple patches for the same resource", () => {
    const bucket = mkBucket("MyBucket", { bucketName: "original" });
    const encrypted: typeof bucket = {
      ...bucket,
      properties: {
        ...bucket.properties,
        bucketEncryption: {
          serverSideEncryptionConfiguration: [{
            serverSideEncryptionByDefault: { sseAlgorithm: "AES256" },
          }],
        },
      },
    };
    updateResource("MyBucket", "AWS::S3::Bucket", encrypted.properties);

    const template = synth();

    expect(template.Resources.MyBucket.Properties).toMatchObject({
      BucketName: "original",
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{
          ServerSideEncryptionByDefault: { SseAlgorithm: "AES256" },
        }],
      },
    });
  });
});
