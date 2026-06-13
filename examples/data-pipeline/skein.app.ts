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
import { mkQueue, getQueueAtt } from "../../src/generated/sqs.js";
import { mkTopic, getTopicAtt } from "../../src/generated/sns.js";
import { ref } from "../../src/runtime/resource.js";
import { pipe } from "../../src/boxes/pipe.js";
import { mkLambda } from "../../src/boxes/lambda-helpers.js";
import { addEnvironment } from "../../src/boxes/lambda.js";
import { grantTableReadWrite } from "../../src/boxes/dynamodb.js";
import { grantSendMessage, triggerFromQueue, withDLQ } from "../../src/boxes/sqs.js";
import { onSchedule } from "../../src/boxes/events.js";
import { alarmOnMetric, notifyOnAlarm } from "../../src/boxes/monitoring.js";

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

// === Functions ===

const processor = mkLambda("Processor", {
  runtime: "nodejs20.x",
  handler: "index.handler",
  code: { s3Bucket: "pipeline-code", s3Key: "processor.zip" },
  timeout: 60,
  memorySize: 256,
});

const reprocessor = mkLambda("Reprocessor", {
  runtime: "nodejs20.x",
  handler: "index.handler",
  code: { s3Bucket: "pipeline-code", s3Key: "reprocessor.zip" },
  timeout: 120,
  memorySize: 256,
});

// === Wiring ===

pipe(processor)
  .to(grantTableReadWrite, dataTable)
  .to(grantSendMessage, failureQueue)
  .to(onSchedule, "rate(5 minutes)")
  .to(addEnvironment, "TABLE_NAME", ref(dataTable))
  .to(addEnvironment, "FAILURE_QUEUE_URL", getQueueAtt(failureQueue, "QueueUrl"))
  .done();

pipe(reprocessor)
  .to(grantTableReadWrite, dataTable)
  .to(triggerFromQueue, failureQueue)
  .to(addEnvironment, "TABLE_NAME", ref(dataTable))
  .done();

// === Monitoring ===

const dlqAlarm = alarmOnMetric("DLQMessageAlarm", {
  namespace: "AWS/SQS",
  metricName: "ApproximateNumberOfMessagesVisible",
  dimensions: [{ name: "QueueName", value: getQueueAtt(dlq, "QueueName") }],
  statistic: "Sum",
  period: 300,
  threshold: 1,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
  evaluationPeriods: 1,
});

notifyOnAlarm(dlqAlarm, alertTopic);
