import { Table } from "../generated/dynamodb.js";
import { LambdaFunction } from "../generated/lambda.js";
import { RestApi } from "../generated/apigateway.js";
import { ref } from "../runtime/resource.js";
import { box } from "../runtime/box.js";
import { pipe } from "./pipe.js";
import { mkLambda, SimpleFunctionProps } from "./lambda-helpers.js";
import { addEnvironment } from "./lambda.js";
import { grantTableReadWrite } from "./dynamodb.js";
import { mkApi, HttpMethod } from "./api.js";

export type CrudApiProps = {
  table: Table;
  routes: Record<string, HttpMethod[]>;
  functionProps: SimpleFunctionProps;
  stageName?: string;
  description?: string;
};

export type CrudApi = {
  readonly handler: LambdaFunction;
  readonly restApi: RestApi;
  readonly stageUrl: string;
};

/**
 * Creates a serverless CRUD API backed by a DynamoDB table.
 *
 * Produces: Lambda handler (with table grants and TABLE_NAME/TABLE_ARN env vars),
 * API Gateway REST API with the specified routes, deployment, and stage.
 *
 * The handler receives all routes — routing by path/method is done inside the
 * Lambda code itself (API Gateway proxies all matched methods to the single handler).
 */
export const crudApi = box(
  "crudApi",
  (logicalId: string, props: CrudApiProps): CrudApi => {
    const { table, routes, functionProps, stageName, description } = props;

    const handler = pipe(mkLambda(`${logicalId}Handler`, functionProps))
      .to(grantTableReadWrite, table)
      .to(addEnvironment, "TABLE_NAME", ref(table))
      .to(addEnvironment, "TABLE_ARN", table.arn)
      .done();

    const routeDefinitions: Record<string, { methods: HttpMethod[]; handler: LambdaFunction }> = {};
    for (const [path, methods] of Object.entries(routes)) {
      routeDefinitions[path] = { methods, handler };
    }

    const { restApi, stageUrl } = mkApi(logicalId, {
      name: logicalId,
      description,
      stageName,
      routes: routeDefinitions,
    });

    return { handler, restApi, stageUrl };
  },
);