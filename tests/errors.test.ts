import { describe, it, expect } from "vitest";
import { synthTest } from "../src/testing/index";
import { mkBucket } from "../src/generated/s3";
import { encrypt } from "../src/boxes/s3";
import { ref } from "../src/runtime/resource";
import { mkPolicy } from "../src/generated/iam";
import { ConflictError } from "../src/runtime/errors";
import { resetAll } from "../src/testing/index";
import { synth } from "../src/runtime/synth";
import { updateResource } from "../src/runtime/registry";

describe("error messages", () => {
  it("conflict error includes path and hint", () => {
    expect(() =>
      synthTest(() => {
        const b = mkBucket("B", { bucketName: "first" });
        updateResource("B", "AWS::S3::Bucket", { bucketName: "second" });
      }),
    ).toThrow(ConflictError);

    try {
      synthTest(() => {
        const b = mkBucket("B", { bucketName: "first" });
        updateResource("B", "AWS::S3::Bucket", { bucketName: "second" });
      });
    } catch (e) {
      const err = e as ConflictError;
      expect(err.message).toContain("B.bucketName");
      expect(err.message).toContain("first");
      expect(err.message).toContain("second");
      expect(err.message).toContain("Hint");
    }
  });

  it("reference error names both source and target", () => {
    try {
      synthTest(() => {
        const phantom = { __type: "AWS::S3::Bucket", logicalId: "Ghost", properties: {} } as const;
        mkPolicy("P", { policyName: "p", policyDocument: {}, roles: [ref(phantom)] });
      });
    } catch (e) {
      const err = e as Error;
      expect(err.message).toContain("P");
      expect(err.message).toContain("Ghost");
      expect(err.message).toContain("does not exist");
      expect(err.message).toContain("Hint");
    }
  });
});
