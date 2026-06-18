type OrderEvent = {
  id: string;
  items: { sku: string; quantity: number; price: number }[];
  customer: { email: string; address: string };
};

export async function handler(event: OrderEvent) {
  if (!event.items || event.items.length === 0) {
    throw new Error("Order must have at least one item");
  }

  for (const item of event.items) {
    if (item.quantity <= 0) throw new Error(`Invalid quantity for ${item.sku}`);
    if (item.price <= 0) throw new Error(`Invalid price for ${item.sku}`);
  }

  if (!event.customer?.email) throw new Error("Customer email is required");

  const total = event.items.reduce((sum, i) => sum + i.quantity * i.price, 0);

  return { ...event, total, validated: true };
}

