const PRODUCTS = [
  { sku: "WIDGET-001", name: "Blue Widget", price: 9.99, stock: 150 },
  { sku: "WIDGET-002", name: "Red Widget", price: 12.99, stock: 75 },
  { sku: "GADGET-001", name: "Mini Gadget", price: 49.99, stock: 30 },
];

export async function handler() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(PRODUCTS),
  };
}
