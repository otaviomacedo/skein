type WarehouseEvent = {
  Records: { Sns: { Message: string } }[];
};

export async function handler(event: WarehouseEvent) {
  for (const record of event.Records) {
    const order = JSON.parse(record.Sns.Message);
    console.log(`Warehouse: preparing shipment for order ${order.id}`);
    console.log(`Items: ${order.items.map((i: any) => `${i.sku} x${i.quantity}`).join(", ")}`);
  }

  return { processed: event.Records.length };
}

