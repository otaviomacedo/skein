import type { Table } from "../../../src/generated/dynamodb.js";
import type { Topic } from "../../../src/generated/sns.js";
import type { LambdaFunction } from "../../../src/generated/lambda.js";
import type { StateMachine } from "../../../src/generated/stepfunctions.js";
import type { Asset } from "../../../src/runtime/assets.js";
import { mkQueue } from "../../../src/generated/sqs.js";
import { ref } from "../../../src/runtime/resource.js";
import { box } from "../../../src/runtime/box.js";
import { pipe } from "../../../src/boxes/pipe.js";
import { mkLambda } from "../../../src/boxes/lambda-helpers.js";
import { addEnvironment } from "../../../src/boxes/lambda.js";
import { grantTableReadWrite } from "../../../src/boxes/dynamodb.js";
import { grantSendMessage, triggerFromQueue, withDLQ } from "../../../src/boxes/sqs.js";
import { grantPublish } from "../../../src/boxes/sns.js";
import { grantStartExecution } from "../../../src/boxes/step-functions-grant.js";
import { stepFunctionsPipeline } from "../../../src/boxes/step-functions.js";
import { queueProcessor } from "../../../src/boxes/queue-processor.js";
import { alarmOnMetric, notifyOnAlarm } from "../../../src/boxes/monitoring.js";

export type OrderFulfillmentProps = {
  ordersTable: Table;
  inventoryTable: Table;
  fulfilledTopic: Topic;
  opsAlertTopic: Topic;
  apiHandler: LambdaFunction;
  validateCode: Asset;
  chargeCode: Asset;
  reserveCode: Asset;
  confirmCode: Asset;
  notifyFulfilledCode: Asset;
  consumerCode: Asset;
  dlqProcessorCode: Asset;
};

export type OrderFulfillment = {
  readonly stateMachine: StateMachine;
};

/**
 * Creates the order fulfillment subsystem:
 *
 * - Wires the API handler to send orders to the fulfillment queue
 * - A consumer Lambda triggers from the queue and starts the Step Functions execution
 * - The workflow: Validate → Charge → Reserve Inventory → Confirm → Notify (SNS)
 * - High-value orders (> $10,000) go through a hold state before processing
 * - Payment failures route to a terminal fail state
 */
export const orderFulfillment = box(
  "orderFulfillment",
  (logicalId: string, props: OrderFulfillmentProps): OrderFulfillment => {
    const {
      ordersTable, inventoryTable, fulfilledTopic, opsAlertTopic, apiHandler,
      validateCode, chargeCode, reserveCode, confirmCode, notifyFulfilledCode, consumerCode, dlqProcessorCode,
    } = props;

    // Internal queues for buffering and failure handling
    const fulfillmentQueue = mkQueue(`${logicalId}Queue`, {
      visibilityTimeout: 300,
      messageRetentionPeriod: 86400,
    });

    const dlq = mkQueue(`${logicalId}DLQ`, {
      messageRetentionPeriod: 1209600,
      visibilityTimeout: 360,
    });

    withDLQ(fulfillmentQueue, dlq, 3);

    // --- Workflow step functions ---

    const validateFn = mkLambda(`${logicalId}Validate`, {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: validateCode.s3Bucket, s3Key: validateCode.s3Key },
      timeout: 10,
      memorySize: 128,
    });

    const chargeFn = mkLambda(`${logicalId}Charge`, {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: chargeCode.s3Bucket, s3Key: chargeCode.s3Key },
      timeout: 30,
      memorySize: 128,
    });

    const reserveFn = pipe(mkLambda(`${logicalId}Reserve`, {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: reserveCode.s3Bucket, s3Key: reserveCode.s3Key },
      timeout: 30,
      memorySize: 128,
    }))
      .to(grantTableReadWrite, inventoryTable)
      .to(addEnvironment, "INVENTORY_TABLE", ref(inventoryTable))
      .done();

    const confirmFn = mkLambda(`${logicalId}Confirm`, {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: confirmCode.s3Bucket, s3Key: confirmCode.s3Key },
      timeout: 10,
      memorySize: 128,
    });

    const notifyFn = pipe(mkLambda(`${logicalId}Notify`, {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: notifyFulfilledCode.s3Bucket, s3Key: notifyFulfilledCode.s3Key },
      timeout: 10,
      memorySize: 128,
    }))
      .to(grantPublish, fulfilledTopic)
      .to(addEnvironment, "TOPIC_ARN", fulfilledTopic.topicArn)
      .done();

    // --- State machine ---

    const { stateMachine } = stepFunctionsPipeline(logicalId, {
      steps: [
        { name: "Validate", fn: validateFn, retry: [{ errorEquals: ["States.TaskFailed"], maxAttempts: 2, backoffRate: 2 }] },
        {
          name: "CheckTotal",
          choices: [
            { variable: "$.total", comparison: "NumericGreaterThan", value: 10000, next: "HighValueHold" },
          ],
          default: "ProcessPayment",
        },
        { name: "ProcessPayment", fn: chargeFn, catch: [{ errorEquals: ["States.ALL"], next: "PaymentFailed", resultPath: "$.error" }] },
        { name: "ReserveStock", fn: reserveFn },
        { name: "Confirm", fn: confirmFn },
        { name: "NotifyFulfilled", fn: notifyFn },
        { name: "Done", succeed: true as const },
        { name: "HighValueHold", seconds: 0 },
        { name: "ProcessPaymentAfterHold", fn: chargeFn },
        { name: "ReserveStockAfterHold", fn: reserveFn },
        { name: "ConfirmAfterHold", fn: confirmFn },
        { name: "NotifyFulfilledAfterHold", fn: notifyFn },
        { name: "DoneAfterHold", succeed: true as const },
        { name: "PaymentFailed", error: "PaymentError", cause: "Payment processing failed" },
      ],
    });

    // --- Wire API handler to send to queue ---

    pipe(apiHandler)
      .to(grantSendMessage, fulfillmentQueue)
      .to(addEnvironment, "FULFILLMENT_QUEUE_URL", fulfillmentQueue.queueUrl)
      .done();

    // --- Queue consumer starts the workflow ---

    pipe(mkLambda(`${logicalId}Consumer`, {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: consumerCode.s3Bucket, s3Key: consumerCode.s3Key },
      timeout: 30,
      memorySize: 128,
    }))
      .to(triggerFromQueue, fulfillmentQueue)
      .to(grantStartExecution, stateMachine)
      .to(addEnvironment, "STATE_MACHINE_ARN", stateMachine.arn)
      .done();

    // --- DLQ processor: records failed orders ---

    queueProcessor(`${logicalId}DLQProcessor`, {
      table: ordersTable,
      queue: dlq,
      functionProps: {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: dlqProcessorCode.s3Bucket, s3Key: dlqProcessorCode.s3Key },
        timeout: 60,
        memorySize: 128,
      },
    });

    // --- DLQ depth alarm ---

    const dlqAlarm = alarmOnMetric(`${logicalId}DLQAlarm`, {
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensions: [{ name: "QueueName", value: dlq.queueName }],
      threshold: 5,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      evaluationPeriods: 2,
      period: 300,
    });

    notifyOnAlarm(dlqAlarm, opsAlertTopic);

    return { stateMachine };
  },
);
