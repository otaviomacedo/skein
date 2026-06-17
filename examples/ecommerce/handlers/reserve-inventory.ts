import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const db = new DynamoDBClient({});
const TABLE = process.env.INVENTORY_TABLE!;

type InventoryEvent = {
  id: string;
  items: { sku: string; quantity: number }[];
};

export async function handler(event: InventoryEvent) {
  const reservations: string[] = [];

  for (const item of event.items) {
    await db.send(new UpdateItemCommand({
      TableName: TABLE,
      Key: marshall({ pk: `SKU#${item.sku}`, sk: "STOCK" }),
      UpdateExpression: "SET reserved = reserved + :qty",
      ExpressionAttributeValues: marshall({ ":qty": item.quantity }),
    }));
    reservations.push(`${item.sku}:${item.quantity}`);
  }

  return { ...event, reservations, inventoryReserved: true };
}
