import { describe, it, expect } from "vitest";
import { diffTemplates, formatDiff } from "../src/cli/diff";
import { Template } from "../src/runtime/synth";

function makeTemplate(resources: Template["Resources"]): Template {
  return { AWSTemplateFormatVersion: "2010-09-09", Resources: resources };
}

describe("diff", () => {
  it("detects added resources", () => {
    const prev = makeTemplate({
      A: { Type: "AWS::S3::Bucket", Properties: {} },
    });
    const curr = makeTemplate({
      A: { Type: "AWS::S3::Bucket", Properties: {} },
      B: { Type: "AWS::Lambda::Function", Properties: {} },
    });
    const entries = diffTemplates(prev, curr);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "added", logicalId: "B" });
  });

  it("detects removed resources", () => {
    const prev = makeTemplate({
      A: { Type: "AWS::S3::Bucket", Properties: {} },
      B: { Type: "AWS::Lambda::Function", Properties: {} },
    });
    const curr = makeTemplate({
      A: { Type: "AWS::S3::Bucket", Properties: {} },
    });
    const entries = diffTemplates(prev, curr);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "removed", logicalId: "B" });
  });

  it("detects modified resources", () => {
    const prev = makeTemplate({
      A: { Type: "AWS::S3::Bucket", Properties: { bucketName: "old" } },
    });
    const curr = makeTemplate({
      A: { Type: "AWS::S3::Bucket", Properties: { bucketName: "new" } },
    });
    const entries = diffTemplates(prev, curr);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "modified", logicalId: "A" });
  });

  it("returns empty for identical templates", () => {
    const t = makeTemplate({ A: { Type: "AWS::S3::Bucket", Properties: { x: 1 } } });
    expect(diffTemplates(t, t)).toHaveLength(0);
  });

  it("handles null previous (first synth)", () => {
    const curr = makeTemplate({
      A: { Type: "AWS::S3::Bucket", Properties: {} },
      B: { Type: "AWS::IAM::Role", Properties: {} },
    });
    const entries = diffTemplates(null, curr);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.type === "added")).toBe(true);
  });

  it("formatDiff produces readable output", () => {
    const entries = diffTemplates(null, makeTemplate({
      Bucket: { Type: "AWS::S3::Bucket", Properties: {} },
    }));
    const output = formatDiff(entries);
    expect(output).toContain("+ 1 resource(s) to add");
    expect(output).toContain("Bucket");
  });

  it("formatDiff returns 'No changes.' for empty diff", () => {
    expect(formatDiff([])).toBe("No changes.");
  });
});
