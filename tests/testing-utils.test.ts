import { describe, it, expect } from "vitest";
import {
  synthTest,
  hasResource,
  hasOutput,
  resourceCount,
  resourceCountIs,
  resourceOfType,
  resourceIds,
} from "../src/testing/index";
import { mkBucket } from "../src/generated/s3";
import { mkRole } from "../src/generated/iam";
import { mkFunction } from "../src/lib/lambda";
import { encrypt, enableVersioning } from "../src/boxes/s3";
import { grantRead } from "../src/boxes/iam";
import { output } from "../src/runtime/outputs";
import { getBucketAtt } from "../src/generated/s3";

describe("testing utilities", () => {
  describe("synthTest", () => {
    it("resets state and synthesizes in isolation", () => {
      const t1 = synthTest(() => {
        mkBucket("A", {});
      });
      const t2 = synthTest(() => {
        mkBucket("B", {});
        mkBucket("C", {});
      });

      expect(resourceCount(t1)).toBe(1);
      expect(resourceCount(t2)).toBe(2);
      expect(resourceIds(t1)).toEqual(["A"]);
      expect(resourceIds(t2).sort()).toEqual(["B", "C"]);
    });
  });

  describe("hasResource", () => {
    it("checks existence by logical ID", () => {
      const t = synthTest(() => {
        mkBucket("MyBucket", { bucketName: "test" });
      });
      expect(hasResource(t, "MyBucket")).toBe(true);
      expect(hasResource(t, "Other")).toBe(false);
    });

    it("checks type", () => {
      const t = synthTest(() => {
        mkBucket("B", {});
      });
      expect(hasResource(t, "B", { type: "AWS::S3::Bucket" })).toBe(true);
      expect(hasResource(t, "B", { type: "AWS::Lambda::Function" })).toBe(false);
    });

    it("checks property subset", () => {
      const t = synthTest(() => {
        mkBucket("B", { bucketName: "hello" });
        encrypt(mkBucket("B2", { bucketName: "world" }));
      });
      expect(hasResource(t, "B", { properties: { bucketName: "hello" } })).toBe(true);
      expect(hasResource(t, "B", { properties: { bucketName: "wrong" } })).toBe(false);
      expect(hasResource(t, "B2", {
        properties: { bucketEncryption: expect.anything() as unknown as Record<string, unknown> },
      })).toBe(false); // containsSubset doesn't use expect matchers
    });
  });

  describe("hasOutput", () => {
    it("checks output existence", () => {
      const t = synthTest(() => {
        const b = mkBucket("B", {});
        output("BucketArn", getBucketAtt(b, "Arn"));
      });
      expect(hasOutput(t, "BucketArn")).toBe(true);
      expect(hasOutput(t, "Other")).toBe(false);
    });
  });

  describe("resourceOfType", () => {
    it("filters by type", () => {
      const t = synthTest(() => {
        mkBucket("B1", {});
        mkBucket("B2", {});
        mkRole("R", { assumeRolePolicyDocument: {} });
      });
      expect(resourceOfType(t, "AWS::S3::Bucket")).toHaveLength(2);
      expect(resourceOfType(t, "AWS::IAM::Role")).toHaveLength(1);
      expect(resourceOfType(t, "AWS::Lambda::Function")).toHaveLength(0);
    });
  });

  describe("resourceCountIs", () => {
    it("checks exact count", () => {
      const t = synthTest(() => {
        mkBucket("A", {});
        mkBucket("B", {});
      });
      expect(resourceCountIs(t, 2)).toBe(true);
      expect(resourceCountIs(t, 3)).toBe(false);
    });
  });
});
