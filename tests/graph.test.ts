import { describe, it, expect, beforeEach } from "vitest";
import { resetTokens } from "../src/runtime/tokens";
import { resetRegistry } from "../src/runtime/registry";
import { resetGraph, buildGraph } from "../src/runtime/graph";
import { mkBucket } from "../src/generated/s3";
import { mkRole } from "../src/generated/iam";
import { mkFunction } from "../src/lib/lambda";
import { encrypt, enableVersioning } from "../src/boxes/s3";
import { grantRead } from "../src/boxes/iam";

function reset() {
  resetTokens();
  resetRegistry();
  resetGraph();
}

describe("graph IR", () => {
  beforeEach(reset);

  it("records generator calls as nodes with no inputs", () => {
    mkBucket("Bucket", {});
    const graph = buildGraph();

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].box).toBe("mkBucket");
    expect(graph.nodes[0].inputs).toEqual([]);
    expect(graph.nodes[0].outputs).toEqual([
      { resourceId: "Bucket", type: "AWS::S3::Bucket" },
    ]);
  });

  it("records transformer calls with input/output edges", () => {
    const bucket = mkBucket("B", {});
    const bucket2 = encrypt(bucket);

    const graph = buildGraph();

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].box).toBe("mkBucket");
    expect(graph.nodes[1].box).toBe("encrypt");
    expect(graph.nodes[1].inputs).toEqual([
      { resourceId: "B", type: "AWS::S3::Bucket" },
    ]);
    expect(graph.nodes[1].outputs).toEqual([
      { resourceId: "B", type: "AWS::S3::Bucket" },
    ]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual({
      from: graph.nodes[0].id,
      output: 0,
      to: graph.nodes[1].id,
      input: 0,
    });
  });

  it("records sequential composition as a chain", () => {
    const bucket = mkBucket("B", {});
    const b2 = encrypt(bucket);
    const b3 = enableVersioning(b2);

    const graph = buildGraph();

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0].from).toBe(graph.nodes[0].id);
    expect(graph.edges[0].to).toBe(graph.nodes[1].id);
    expect(graph.edges[1].from).toBe(graph.nodes[1].id);
    expect(graph.edges[1].to).toBe(graph.nodes[2].id);
  });

  it("records wirers with multiple inputs and outputs", () => {
    const bucket = mkBucket("Bucket", {});
    const role = mkRole("Role", { assumeRolePolicyDocument: {} });
    const fn = mkFunction("Fn", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code", s3Key: "fn.zip" },
      role,
    });
    const [fn2, bucket2, policy] = grantRead(fn, bucket);

    const graph = buildGraph();

    const grantNode = graph.nodes.find((n) => n.box === "grantRead")!;
    expect(grantNode).toBeDefined();
    expect(grantNode.inputs).toHaveLength(2);
    expect(grantNode.outputs).toHaveLength(3);
  });

  it("builds correct edges for fan-in (multiple inputs from different sources)", () => {
    const bucket = mkBucket("Bucket", {});
    const role = mkRole("Role", { assumeRolePolicyDocument: {} });
    const fn = mkFunction("Fn", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "code", s3Key: "fn.zip" },
      role,
    });
    grantRead(fn, bucket);

    const graph = buildGraph();
    const grantNode = graph.nodes.find((n) => n.box === "grantRead")!;

    const edgesToGrant = graph.edges.filter((e) => e.to === grantNode.id);
    expect(edgesToGrant).toHaveLength(2);
  });
});
