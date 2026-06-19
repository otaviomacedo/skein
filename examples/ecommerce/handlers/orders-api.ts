import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const db = new DynamoDBClient({});
const sqs = new SQSClient({});
const TABLE = process.env.TABLE_NAME!;
const FULFILLMENT_QUEUE_URL = process.env.FULFILLMENT_QUEUE_URL!;

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

  await sqs.send(new SendMessageCommand({
    QueueUrl: FULFILLMENT_QUEUE_URL,
    MessageBody: JSON.stringify({ id, ...body }),
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
  const result = await db.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: "begins_with(pk, :prefix)",
    ExpressionAttributeValues: marshall({ ":prefix": "ORDER#" }),
    Limit: 50,
  }));
  const items = (result.Items || []).map(unmarshall);
  return { statusCode: 200, body: JSON.stringify(items) };
}
