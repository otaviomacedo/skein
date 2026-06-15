import { Table } from "../generated/dynamodb.js";
import { Queue } from "../generated/sqs.js";
import { LambdaFunction } from "../generated/lambda.js";
import { ref } from "../runtime/resource.js";
import { box } from "../runtime/box.js";
import { pipe } from "./pipe.js";
import { mkLambda, SimpleFunctionProps } from "./lambda-helpers.js";
import { addEnvironment } from "./lambda.js";
import { grantTableReadWrite } from "./dynamodb.js";
import { triggerFromQueue } from "./sqs.js";

export type QueueProcessorProps = {
  table: Table;
  queue: Queue;
  batchSize?: number;
  functionProps: SimpleFunctionProps;
};

/**
 * Creates a Lambda function triggered from an SQS queue that writes to a DynamoDB table.
 *
 * Produces: Lambda (with role, table grant, queue trigger, consume policy,
 * and TABLE_NAME env var).
 */
export const queueProcessor = box(
  "queueProcessor",
  (logicalId: string, props: QueueProcessorProps): LambdaFunction => {
    const { table, queue, batchSize, functionProps } = props;

    return pipe(mkLambda(logicalId, functionProps))
      .to(grantTableReadWrite, table)
      .to(triggerFromQueue, queue, batchSize)
      .to(addEnvironment, "TABLE_NAME", ref(table))
      .done();
  },
);