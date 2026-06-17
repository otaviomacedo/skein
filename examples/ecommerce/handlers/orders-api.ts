import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const db = new DynamoDBClient({});
const sfn = new SFNClient({});
const TABLE = process.env.TABLE_NAME!;
const STATE_MACHINE_ARN = process.env.STATE_MACHINE_ARN!;

type Event = {
  httpMethod: string;
  pathParameters?: { id?: string };
  body?: string;
};

export async function handler(event: Event) {
  switch (event.httpMethod) {
    case "POST": return createOrder(event);
    case "GET": return event.pathParameters?.id ? getOrder(event) : listOrders();
    default: return { statusCode: 405, body: "Method not allowed" };
  }
}

async function createOrder(event: Event) {
  const body = JSON.parse(event.body || "{}");
  const id = crypto.randomUUID();
  const order = { pk: `ORDER#${id}`, sk: "META", id, status: "PENDING", ...body, createdAt: new Date().toISOString() };

  await db.send(new PutItemCommand({ TableName: TABLE, Item: marshall(order) }));

  await sfn.send(new StartExecutionCommand({
    stateMachineArn: STATE_MACHINE_ARN,
    name: `order-${id}`,
    input: JSON.stringify({ id, ...body }),
  }));

  return { statusCode: 201, body: JSON.stringify(order) };
}

async function getOrder(event: Event) {
  const id = event.pathParameters!.id!;
  const result = await db.send(new GetItemCommand({ TableName: TABLE, Key: marshall({ pk: `ORDER#${id}`, sk: "META" }) }));
  if (!result.Item) return { statusCode: 404, body: "Not found" };
  return { statusCode: 200, body: JSON.stringify(unmarshall(result.Item)) };
}

async function listOrders() {
  const result = await db.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "begins_with(pk, :prefix)",
    ExpressionAttributeValues: marshall({ ":prefix": "ORDER#" }),
    Limit: 50,
  }));
  const items = (result.Items || []).map(unmarshall);
  return { statusCode: 200, body: JSON.stringify(items) };
}
