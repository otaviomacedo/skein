import { Table } from "../generated/dynamodb.js";
import { Queue } from "../generated/sqs.js";
import { LambdaFunction } from "../generated/lambda.js";
import { ref } from "../runtime/resource.js";
import { box } from "../runtime/box.js";
import { pipe } from "./pipe.js";
import { mkLambda, SimpleFunctionProps } from "./lambda-helpers.js";
import { addEnvironment } from "./lambda.js";
import { grantTableReadWrite } from "./dynamodb.js";
import { grantSendMessage } from "./sqs.js";
import { onSchedule } from "./events.js";

export type ScheduledProcessorProps = {
  schedule: string;
  table: Table;
  failureQueue: Queue;
  functionProps: SimpleFunctionProps;
};

/**
 * Creates a Lambda function triggered on a schedule that writes to a DynamoDB table,
 * with a failure queue for dead-letter handling.
 *
 * Produces: Lambda (with role, table grant, queue send grant, schedule rule,
 * and TABLE_NAME/FAILURE_QUEUE_URL env vars).
 */
export const scheduledProcessor = box(
  "scheduledProcessor",
  (logicalId: string, props: ScheduledProcessorProps): LambdaFunction => {
    const { schedule, table, failureQueue, functionProps } = props;

    return pipe(mkLambda(logicalId, functionProps))
      .to(grantTableReadWrite, table)
      .to(grantSendMessage, failureQueue)
      .to(onSchedule, schedule)
      .to(addEnvironment, "TABLE_NAME", ref(table))
      .to(addEnvironment, "FAILURE_QUEUE_URL", failureQueue.queueUrl)
      .done();
  },
);