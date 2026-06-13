import { describe, it, expect, beforeEach } from "vitest";
import { resetTokens } from "../src/runtime/tokens";
import { resetRegistry } from "../src/runtime/registry";
import { resetStacks, assignStack } from "../src/runtime/stacks";
import { resetParameters } from "../src/runtime/parameters";
import { resetOutputs } from "../src/runtime/outputs";
import { resetConditions } from "../src/runtime/conditions";
import { resetMappings } from "../src/runtime/mappings";
import { synthMulti } from "../src/runtime/synth";
import { ref, getAtt } from "../src/runtime/resource";
import { mkBucket } from "../src/generated/s3";
import { mkRole } from "../src/generated/iam";
import { mkFunction } from "../src/lib/lambda";

function reset() {
  resetTokens();
  resetRegistry();
  resetStacks();
  resetParameters();
  resetOutputs();
  resetConditions();
  resetMappings();
}

describe("multi-stack synth", () => {
  beforeEach(reset);

  it("puts all resources in default stack when no assignments", () => {
    mkBucket("Bucket", {});
    mkRole("Role", { assumeRolePolicyDocument: {} });

    const { templates, stackDependencies } = synthMulti();

    expect(Object.keys(templates)).toEqual(["default"]);
    expect(Object.keys(templates.default.Resources)).toHaveLength(2);
    expect(stackDependencies).toEqual({});
  });

  it("partitions resources into assigned stacks", () => {
    const bucket = mkBucket("Bucket", {});
    const role = mkRole("Role", { assumeRolePolicyDocument: {} });

    assignStack("Bucket", "storage");
    assignStack("Role", "compute");

    const { templates } = synthMulti();

    expect(Object.keys(templates).sort()).toEqual(["compute", "storage"]);
    expect(Object.keys(templates.storage.Resources)).toEqual(["Bucket"]);
    expect(Object.keys(templates.compute.Resources)).toEqual(["Role"]);
  });

  it("detects cross-stack references and adds outputs", () => {
    const bucket = mkBucket("Bucket", {});
    const role = mkRole("Role", { assumeRolePolicyDocument: {} });
    mkFunction("Fn", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: ref(bucket), s3Key: "fn.zip" },
      role,
    });

    assignStack("Bucket", "storage");
    assignStack("Role", "compute");
    assignStack("Fn", "compute");

    const { templates, stackDependencies } = synthMulti();

    // Storage stack should have an Output for the bucket (referenced by compute)
    expect(templates.storage.Outputs).toBeDefined();
    expect(templates.storage.Outputs!["Bucket"]).toEqual({
      Value: { Ref: "Bucket" },
    });

    // Compute depends on storage
    expect(stackDependencies.compute).toContain("storage");
  });

  it("handles GetAtt cross-stack references", () => {
    const role = mkRole("SharedRole", { assumeRolePolicyDocument: {} });
    mkFunction("Fn", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code", s3Key: "fn.zip" },
      role,
    });

    assignStack("SharedRole", "shared");
    assignStack("Fn", "app");

    const { templates, stackDependencies } = synthMulti();

    // Shared stack outputs the role ARN
    expect(templates.shared.Outputs).toBeDefined();
    expect(templates.shared.Outputs!["SharedRoleArn"]).toEqual({
      Value: { "Fn::GetAtt": ["SharedRole", "Arn"] },
    });

    // App depends on shared
    expect(stackDependencies.app).toContain("shared");
  });

  it("uses default stack for unassigned resources", () => {
    mkBucket("AssignedBucket", {});
    mkBucket("UnassignedBucket", {});

    assignStack("AssignedBucket", "storage");

    const { templates } = synthMulti("main");

    expect(Object.keys(templates).sort()).toEqual(["main", "storage"]);
    expect(Object.keys(templates.main.Resources)).toEqual(["UnassignedBucket"]);
    expect(Object.keys(templates.storage.Resources)).toEqual(["AssignedBucket"]);
  });

  it("computes per-stack DependsOn (intra-stack only)", () => {
    const role = mkRole("Role", { assumeRolePolicyDocument: {} });
    mkFunction("Fn", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code", s3Key: "fn.zip" },
      role,
    });

    assignStack("Role", "app");
    assignStack("Fn", "app");

    const { templates } = synthMulti();

    // DependsOn within the same stack works
    expect(templates.app.Resources.Fn.DependsOn).toContain("Role");
  });
});
