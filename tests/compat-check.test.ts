/**
 * Backwards compatibility verification for box versions.
 *
 * Uses the compat checker to mechanically detect whether a new version of a box
 * is safe to upgrade to.
 */

import { describe, it, expect } from "vitest";
import { checkCompat, checkCompatMulti, checkCompatAuto, declareSchema, resource, formatCompatReport } from "../src/compat/index.js";
import { mkTable, Table } from "../src/generated/dynamodb.js";
import { mkQueue, Queue } from "../src/generated/sqs.js";
import { ref } from "../src/runtime/resource.js";
import { pipe } from "../src/boxes/pipe.js";
import { mkLambda, SimpleFunctionProps } from "../src/boxes/lambda-helpers.js";
import { addEnvironment } from "../src/boxes/lambda.js";
import { grantTableReadWrite } from "../src/boxes/dynamodb.js";
import { grantSendMessage } from "../src/boxes/sqs.js";
import { box } from "../src/runtime/box.js";
import { LambdaFunction } from "../src/generated/lambda.js";

// === Box versions ===

type WorkerBox = (id: string, fnProps: SimpleFunctionProps, table: Table, queue: Queue) => LambdaFunction;

/** v1: creates a Lambda wired to table + queue. */
const workerBoxV1: WorkerBox = box(
  "workerBox",
  (logicalId: string, fnProps: SimpleFunctionProps, table: Table, queue: Queue): LambdaFunction => {
    return pipe(mkLambda(logicalId, fnProps))
      .to(grantTableReadWrite, table)
      .to(grantSendMessage, queue)
      .to(addEnvironment, "TABLE_NAME", ref(table))
      .to(addEnvironment, "QUEUE_URL", queue.queueUrl)
      .done();
  },
);

/** v2a (compatible): adds TABLE_ARN env var. Additive change. */
const workerBoxV2Additive: WorkerBox = box(
  "workerBox",
  (logicalId: string, fnProps: SimpleFunctionProps, table: Table, queue: Queue): LambdaFunction => {
    return pipe(mkLambda(logicalId, fnProps))
      .to(grantTableReadWrite, table)
      .to(grantSendMessage, queue)
      .to(addEnvironment, "TABLE_NAME", ref(table))
      .to(addEnvironment, "TABLE_ARN", table.arn)
      .to(addEnvironment, "QUEUE_URL", queue.queueUrl)
      .done();
  },
);

/** v2b (BREAKING): removes queue wiring entirely. */
const workerBoxV2Breaking: WorkerBox = box(
  "workerBox",
  (logicalId: string, fnProps: SimpleFunctionProps, table: Table, _queue: Queue): LambdaFunction => {
    return pipe(mkLambda(logicalId, fnProps))
      .to(grantTableReadWrite, table)
      .to(addEnvironment, "TABLE_NAME", ref(table))
      .done();
  },
);

// === Representative inputs ===

const fnProps: SimpleFunctionProps = {
  runtime: "nodejs20.x",
  handler: "index.handler",
  code: { s3Bucket: "code", s3Key: "worker.zip" },
};

const tableProps = {
  attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
  keySchema: [{ attributeName: "pk", keyType: "HASH" }],
  billingMode: "PAY_PER_REQUEST" as const,
};

function setup(boxFn: WorkerBox) {
  const table = mkTable("Data", tableProps);
  const queue = mkQueue("Out", { visibilityTimeout: 60 });
  boxFn("Worker", fnProps, table, queue);
}

// === Tests ===

describe("checkCompat", () => {
  it("reports strict compatibility for identical boxes", () => {
    const result = checkCompat(workerBoxV1, workerBoxV1, setup);

    expect(result.level).toBe("strict");
    expect(result.diffs).toHaveLength(0);
    expect(result.addedResources).toHaveLength(0);
    expect(result.removedResources).toHaveLength(0);
  });

  it("reports patch-compatible for additive changes", () => {
    const result = checkCompat(workerBoxV1, workerBoxV2Additive, setup);

    expect(result.level).toBe("patch");
    expect(result.diffs).toHaveLength(0);
    expect(result.removedResources).toHaveLength(0);
    // No property regressions — just a new env var added
  });

  it("reports breaking for removed resources", () => {
    const result = checkCompat(workerBoxV1, workerBoxV2Breaking, setup);

    expect(result.level).toBe("breaking");
    expect(result.removedResources.length).toBeGreaterThan(0);
    // The SQS send policy resource should be gone
    expect(result.removedResources.some(id => id.includes("Send"))).toBe(true);
  });

  it("reports detailed property diffs for breaking changes", () => {
    const result = checkCompat(workerBoxV1, workerBoxV2Breaking, setup);

    const report = formatCompatReport(result);
    expect(report).toContain("BREAKING");
    expect(report).toContain("removed");
  });
});

describe("checkCompatMulti", () => {
  it("tests multiple representative inputs and reports worst level", () => {
    const { results, worst } = checkCompatMulti(workerBoxV1, workerBoxV2Additive, [
      {
        name: "minimal",
        setup: (boxFn) => {
          const table = mkTable("T", tableProps);
          const queue = mkQueue("Q", {});
          boxFn("Fn", fnProps, table, queue);
        },
      },
      {
        name: "with timeout",
        setup: (boxFn) => {
          const table = mkTable("T", tableProps);
          const queue = mkQueue("Q", { visibilityTimeout: 120 });
          boxFn("Fn", { ...fnProps, timeout: 60 }, table, queue);
        },
      },
    ]);

    expect(results).toHaveLength(2);
    expect(worst).toBe("patch");
    expect(results.every(r => r.result.level === "patch")).toBe(true);
  });

  it("finds breaking in one input but not another", () => {
    // A contrived box that breaks only for queues with high visibility timeout
    const conditionalBreaking: WorkerBox = box(
      "workerBox",
      (logicalId: string, fnProps: SimpleFunctionProps, table: Table, queue: Queue): LambdaFunction => {
        const fn = pipe(mkLambda(logicalId, fnProps))
          .to(grantTableReadWrite, table)
          .to(addEnvironment, "TABLE_NAME", ref(table))
          .done();

        // Only wire queue if visibilityTimeout > 60 (simulating a conditional bug)
        if ((queue.properties as any).visibilityTimeout > 60) {
          return pipe(fn)
            .to(grantSendMessage, queue)
            .to(addEnvironment, "QUEUE_URL", queue.queueUrl)
            .done();
        }
        return fn;
      },
    );

    const { results, worst } = checkCompatMulti(workerBoxV1, conditionalBreaking, [
      {
        name: "high-timeout queue (compatible path)",
        setup: (boxFn) => {
          const table = mkTable("T", tableProps);
          const queue = mkQueue("Q", { visibilityTimeout: 120 });
          boxFn("Fn", fnProps, table, queue);
        },
      },
      {
        name: "low-timeout queue (breaking path)",
        setup: (boxFn) => {
          const table = mkTable("T", tableProps);
          const queue = mkQueue("Q", { visibilityTimeout: 30 });
          boxFn("Fn", fnProps, table, queue);
        },
      },
    ]);

    expect(worst).toBe("breaking");
    expect(results[0].result.level).not.toBe("breaking");
    expect(results[1].result.level).toBe("breaking");
  });
});

describe("checkCompatAuto", () => {
  const schema = declareSchema({
    inputs: [
      { kind: "string", value: "Worker" },
      { kind: "props", value: { runtime: "nodejs20.x", handler: "index.handler", code: { s3Bucket: "b", s3Key: "k" } } },
      resource("AWS::DynamoDB::Table"),
      resource("AWS::SQS::Queue"),
    ],
  });

  it("detects strict compatibility without manual setup", () => {
    const result = checkCompatAuto(workerBoxV1, workerBoxV1, schema);
    expect(result.level).toBe("strict");
  });

  it("detects patch-compatible without manual setup", () => {
    const result = checkCompatAuto(workerBoxV1, workerBoxV2Additive, schema);
    expect(result.level).toBe("patch");
  });

  it("detects breaking changes without manual setup", () => {
    const result = checkCompatAuto(workerBoxV1, workerBoxV2Breaking, schema);
    expect(result.level).toBe("breaking");
    expect(result.removedResources.length).toBeGreaterThan(0);
  });
});
