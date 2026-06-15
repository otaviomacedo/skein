/**
 * Event-Driven Data Pipeline
 *
 * Architecture:
 *   EventBridge (every 5 min) → Processor Lambda → DynamoDB Table
 *                                                → SQS Queue (failures)
 *   SQS Queue (with DLQ) → Reprocessor Lambda → DynamoDB Table
 *   CloudWatch Alarm on DLQ → SNS Topic (notification)
 */

import { mkTable } from "../../src/generated/dynamodb.js";
import { mkQueue } from "../../src/generated/sqs.js";
import { mkTopic } from "../../src/generated/sns.js";
import { withDLQ } from "../../src/boxes/sqs.js";
import { alarmOnMetric, notifyOnAlarm } from "../../src/boxes/monitoring.js";
import { scheduledProcessor } from "../../src/boxes/scheduled-processor.js";
import { queueProcessor } from "../../src/boxes/queue-processor.js";

// === Data Stores ===

const dataTable = mkTable("DataTable", {
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

// === Queues ===

const failureQueue = mkQueue("FailureQueue", {
  visibilityTimeout: 120,
  messageRetentionPeriod: 86400,
});

const dlq = mkQueue("FailureDLQ", {
  messageRetentionPeriod: 1209600,
});

withDLQ(failureQueue, dlq, 3);

// === Notifications ===

const alertTopic = mkTopic("AlertTopic", {
  topicName: "data-pipeline-alerts",
});

// === Processors ===

scheduledProcessor("Processor", {
  schedule: "rate(5 minutes)",
  table: dataTable,
  failureQueue,
  functionProps: {
    runtime: "nodejs20.x",
    handler: "index.handler",
    code: { s3Bucket: "pipeline-code", s3Key: "processor.zip" },
    timeout: 60,
    memorySize: 256,
  },
});

queueProcessor("Reprocessor", {
  table: dataTable,
  queue: failureQueue,
  functionProps: {
    runtime: "nodejs20.x",
    handler: "index.handler",
    code: { s3Bucket: "pipeline-code", s3Key: "reprocessor.zip" },
    timeout: 120,
    memorySize: 256,
  },
});

// === Monitoring ===

const dlqAlarm = alarmOnMetric("DLQMessageAlarm", {
  namespace: "AWS/SQS",
  metricName: "ApproximateNumberOfMessagesVisible",
  dimensions: [{ name: "QueueName", value: dlq.queueName }],
  statistic: "Sum",
  period: 300,
  threshold: 1,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
  evaluationPeriods: 1,
});

notifyOnAlarm(dlqAlarm, alertTopic);