/**
 * Serverless API Backend
 *
 * Architecture:
 *   API Gateway → Lambda (API handler) → DynamoDB (items table)
 *                                      → SQS (async work queue)
 *   SQS → Lambda (worker) → DynamoDB (items table)
 */

import { mkTable } from "../../src/generated/dynamodb.js";
import { mkQueue } from "../../src/generated/sqs.js";
import { mkAsset } from "../../src/runtime/assets.js";
import { ref } from "../../src/runtime/resource.js";
import { pipe } from "../../src/boxes/pipe.js";
import { mkLambda } from "../../src/boxes/lambda-helpers.js";
import { mkApi } from "../../src/boxes/api.js";
import { addEnvironment } from "../../src/boxes/lambda.js";
import { grantTableReadWrite } from "../../src/boxes/dynamodb.js";
import { grantSendMessage, triggerFromQueue } from "../../src/boxes/sqs.js";

// === Assets ===

const apiCode = mkAsset("ApiCode", {
  type: "bundle",
  path: "./src/api",
  bundler: { runtime: "nodejs20.x", entrypoint: "handler.ts" },
});

const workerCode = mkAsset("WorkerCode", {
  type: "bundle",
  path: "./src/worker",
  bundler: { runtime: "nodejs20.x", entrypoint: "handler.ts" },
});

// === Data Stores ===

const itemsTable = mkTable("ItemsTable", {
  attributeDefinitions: [
    { attributeName: "pk", attributeType: "S" },
    { attributeName: "sk", attributeType: "S" },
  ],
  keySchema: [
    { attributeName: "pk", keyType: "HASH" },
    { attributeName: "sk", keyType: "RANGE" },
  ],
  billingMode: "PAY_PER_REQUEST",
});

const workQueue = mkQueue("WorkQueue", {
  visibilityTimeout: 60,
  messageRetentionPeriod: 86400,
});

const dlq = mkQueue("DeadLetterQueue", {
  messageRetentionPeriod: 1209600,
});

// === Functions ===

const apiFn = mkLambda("ApiHandler", {
  runtime: "nodejs20.x",
  handler: "handler.handler",
  code: { s3Bucket: apiCode.s3Bucket, s3Key: apiCode.s3Key },
  timeout: 30,
  memorySize: 256,
});

const workerFn = mkLambda("Worker", {
  runtime: "nodejs20.x",
  handler: "handler.handler",
  code: { s3Bucket: workerCode.s3Bucket, s3Key: workerCode.s3Key },
  timeout: 60,
  memorySize: 512,
});

// === Wiring ===

pipe(apiFn)
  .to(grantTableReadWrite, itemsTable)
  .to(grantSendMessage, workQueue)
  .to(addEnvironment, "TABLE_NAME", ref(itemsTable))
  .to(addEnvironment, "QUEUE_URL", workQueue.queueUrl)
  .done();

pipe(workerFn)
  .to(grantTableReadWrite, itemsTable)
  .to(triggerFromQueue, workQueue)
  .to(addEnvironment, "TABLE_NAME", ref(itemsTable))
  .done();

// === API ===

mkApi("ItemsApi", {
  name: "ItemsAPI",
  description: "CRUD API for items",
  routes: {
    "/items": {
      methods: ["GET", "POST"],
      handler: apiFn,
    },
  },
});
