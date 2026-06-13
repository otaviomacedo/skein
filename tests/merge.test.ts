import { describe, it, expect } from "vitest";
import { mergePatchesByLogicalId, ConflictError } from "../src/runtime/merge";

describe("merge", () => {
  it("merges patches for different logical IDs independently", () => {
    const result = mergePatchesByLogicalId([
      { logicalId: "A", type: "AWS::S3::Bucket", properties: { bucketName: "a" } },
      { logicalId: "B", type: "AWS::S3::Bucket", properties: { bucketName: "b" } },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.logicalId === "A")!.properties).toEqual({ bucketName: "a" });
    expect(result.find((r) => r.logicalId === "B")!.properties).toEqual({ bucketName: "b" });
  });

  it("merges non-conflicting patches for the same logical ID", () => {
    const result = mergePatchesByLogicalId([
      { logicalId: "A", type: "AWS::S3::Bucket", properties: { bucketName: "my-bucket" } },
      {
        logicalId: "A",
        type: "AWS::S3::Bucket",
        properties: {
          versioningConfiguration: { status: "Enabled" },
        },
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].properties).toEqual({
      bucketName: "my-bucket",
      versioningConfiguration: { status: "Enabled" },
    });
  });

  it("deep merges nested objects", () => {
    const result = mergePatchesByLogicalId([
      { logicalId: "A", type: "T", properties: { config: { a: 1 } } },
      { logicalId: "A", type: "T", properties: { config: { b: 2 } } },
    ]);
    expect(result[0].properties).toEqual({ config: { a: 1, b: 2 } });
  });

  it("throws ConflictError on conflicting scalar values", () => {
    expect(() =>
      mergePatchesByLogicalId([
        { logicalId: "A", type: "T", properties: { name: "foo" } },
        { logicalId: "A", type: "T", properties: { name: "bar" } },
      ]),
    ).toThrow(ConflictError);
  });

  it("does not conflict when same value is set by multiple patches", () => {
    const result = mergePatchesByLogicalId([
      { logicalId: "A", type: "T", properties: { name: "same" } },
      { logicalId: "A", type: "T", properties: { name: "same" } },
    ]);
    expect(result[0].properties).toEqual({ name: "same" });
  });

  it("concatenates Tags arrays (mergeable collection)", () => {
    const result = mergePatchesByLogicalId([
      { logicalId: "A", type: "T", properties: { Tags: [{ key: "a", value: "1" }] } },
      { logicalId: "A", type: "T", properties: { Tags: [{ key: "b", value: "2" }] } },
    ]);
    expect(result[0].properties.Tags).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ]);
  });

  it("throws ConflictError on non-mergeable array conflict", () => {
    expect(() =>
      mergePatchesByLogicalId([
        { logicalId: "A", type: "T", properties: { items: [1, 2] } },
        { logicalId: "A", type: "T", properties: { items: [3, 4] } },
      ]),
    ).toThrow(ConflictError);
  });

  it("does not conflict on deeply equal objects", () => {
    const result = mergePatchesByLogicalId([
      { logicalId: "A", type: "T", properties: { config: { nested: { x: 1 } } } },
      { logicalId: "A", type: "T", properties: { config: { nested: { x: 1 } } } },
    ]);
    expect(result[0].properties).toEqual({ config: { nested: { x: 1 } } });
  });
});
