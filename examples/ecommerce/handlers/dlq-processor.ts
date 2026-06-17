import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const db = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME!;

type SQSEvent = {
  Records: { body: string; messageId: string; attributes: { ApproximateReceiveCount: string } }[];
};

export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const order = JSON.parse(record.body);

    await db.send(new PutItemCommand({
      TableName: TABLE,
      Item: marshall({
        pk: `FAILED#${order.id}`,
        sk: `ATTEMPT#${record.attributes.ApproximateReceiveCount}`,
        order,
        messageId: record.messageId,
        failedAt: new Date().toISOString(),
      }),
    }));

    console.error(`Order ${order.id} moved to DLQ after ${record.attributes.ApproximateReceiveCount} attempts`);
  }

  return { processed: event.Records.length };
}
