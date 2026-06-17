/**
 * Re-presentation: two programs using structurally different box decompositions
 * that produce identical CloudFormation templates.
 *
 * Scenario: We need a Lambda function with:
 *   - A DynamoDB table (with read/write grant + TABLE_NAME env)
 *   - An SQS queue (with send grant + QUEUE_URL env)
 *   - A schedule trigger (EventBridge rule)
 *
 * These three wiring concerns (table, queue, schedule) are independent — they
 * touch non-overlapping parts of the resource graph. So we can group them in
 * any order. Two libraries choose different factorizations:
 *
 * Library X ("scheduled-writer" pattern):
 *   Box A = "scheduledFn": creates Lambda + schedule rule (bundles fn + trigger)
 *   Box B = "wireTableAndQueue": grants table + queue access (bundles both data stores)
 *   Program: scheduledFn() → wireTableAndQueue(fn, table, queue)
 *
 * Library Y ("table-processor" pattern):
 *   Box C = "tableProcessor": creates Lambda + table grant + env (bundles fn + table)
 *   Box D = "addQueueAndSchedule": grants queue access + adds schedule (bundles queue + trigger)
 *   Program: tableProcessor(table) → addQueueAndSchedule(fn, queue, schedule)
 *
 * The decompositions are non-trivially different: Library X groups the Lambda with
 * its trigger, Library Y groups the Lambda with its table. The boxes contain different
 * primitives internally. Yet both produce the same template.
 */

import { describe, it, expect } from "vitest";
import { synthTest } from "../src/testing/index.js";
import { mkTable, Table } from "../src/generated/dynamodb.js";
import { mkQueue, Queue } from "../src/generated/sqs.js";
import { ref } from "../src/runtime/resource.js";
import { pipe } from "../src/boxes/pipe.js";
import { mkLambda, SimpleFunctionProps } from "../src/boxes/lambda-helpers.js";
import { addEnvironment } from "../src/boxes/lambda.js";
import { grantTableReadWrite } from "../src/boxes/dynamodb.js";
import { grantSendMessage } from "../src/boxes/sqs.js";
import { onSchedule } from "../src/boxes/events.js";
import { box } from "../src/runtime/box.js";
import { LambdaFunction } from "../src/generated/lambda.js";

// === Library X: "scheduled-writer" ===

/** Creates a Lambda and attaches a schedule trigger. */
const scheduledFn = box(
  "scheduledFn",
  (logicalId: string, props: SimpleFunctionProps, schedule: string): LambdaFunction => {
    const fn = mkLambda(logicalId, props);
    const [fn2] = onSchedule(fn, schedule);
    return fn2;
  },
);

/** Grants a Lambda access to a table and a queue, injects both as env vars. */
const wireTableAndQueue = box(
  "wireTableAndQueue",
  (fn: LambdaFunction, table: Table, queue: Queue): LambdaFunction => {
    return pipe(fn)
      .to(grantTableReadWrite, table)
      .to(grantSendMessage, queue)
      .to(addEnvironment, "TABLE_NAME", ref(table))
      .to(addEnvironment, "QUEUE_URL", queue.queueUrl)
      .done();
  },
);

// === Library Y: "table-processor" ===

/** Creates a Lambda wired to a DynamoDB table (grant + env). */
const tableProcessor = box(
  "tableProcessor",
  (logicalId: string, props: SimpleFunctionProps, table: Table): LambdaFunction => {
    return pipe(mkLambda(logicalId, props))
      .to(grantTableReadWrite, table)
      .to(addEnvironment, "TABLE_NAME", ref(table))
      .done();
  },
);

/** Grants queue access and attaches a schedule trigger. */
const addQueueAndSchedule = box(
  "addQueueAndSchedule",
  (fn: LambdaFunction, queue: Queue, schedule: string): LambdaFunction => {
    return pipe(fn)
      .to(grantSendMessage, queue)
      .to(onSchedule, schedule)
      .to(addEnvironment, "QUEUE_URL", queue.queueUrl)
      .done();
  },
);

// === The test ===

describe("re-presentation", () => {
  const fnProps: SimpleFunctionProps = {
    runtime: "nodejs20.x",
    handler: "index.handler",
    code: { s3Bucket: "code", s3Key: "worker.zip" },
    timeout: 30,
    memorySize: 256,
  };

  const tableProps = {
    attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
    keySchema: [{ attributeName: "pk", keyType: "HASH" }],
    billingMode: "PAY_PER_REQUEST" as const,
  };

  it("library X (scheduled-writer) and library Y (table-processor) produce identical templates", () => {
    // Program 1 (Library X): scheduledFn → wireTableAndQueue
    const templateX = synthTest(() => {
      const table = mkTable("DataTable", tableProps);
      const queue = mkQueue("OutQueue", { visibilityTimeout: 60 });

      const fn = scheduledFn("Worker", fnProps, "rate(5 minutes)");
      wireTableAndQueue(fn, table, queue);
    });

    // Program 2 (Library Y): tableProcessor → addQueueAndSchedule
    const templateY = synthTest(() => {
      const table = mkTable("DataTable", tableProps);
      const queue = mkQueue("OutQueue", { visibilityTimeout: 60 });

      const fn = tableProcessor("Worker", fnProps, table);
      addQueueAndSchedule(fn, queue, "rate(5 minutes)");
    });

    // Different decomposition, same template
    expect(templateX).toEqual(templateY);
  });
});
