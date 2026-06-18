/**
 * Integration tests for the deployed E-Commerce application.
 *
 * Prerequisites:
 *   - The stack "main" is deployed in us-east-1
 *   - AWS credentials are configured
 *
 * Run with: npx vitest run examples/ecommerce/integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CloudFormationClient, DescribeStacksCommand, DescribeStackResourcesCommand } from "@aws-sdk/client-cloudformation";
import { DynamoDBClient, GetItemCommand, DeleteItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { SFNClient, DescribeExecutionCommand, ListExecutionsCommand } from "@aws-sdk/client-sfn";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const REGION = "us-east-1";
const STACK_NAME = "main";

const cfn = new CloudFormationClient({ region: REGION });
const dynamodb = new DynamoDBClient({ region: REGION });
const sfn = new SFNClient({ region: REGION });

let apiUrl: string;
let ordersTableName: string;
let inventoryTableName: string;
let stateMachineArn: string;

const createdOrderIds: string[] = [];

beforeAll(async () => {
  // Get stack outputs
  const stacks = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const outputs = stacks.Stacks![0].Outputs!;
  apiUrl = outputs.find(o => o.OutputKey === "OrdersApiUrl")!.OutputValue!;
  stateMachineArn = outputs.find(o => o.OutputKey === "OrderFulfillmentArn")!.OutputValue!;

  // Get physical table names
  const resources = await cfn.send(new DescribeStackResourcesCommand({ StackName: STACK_NAME }));
  ordersTableName = resources.StackResources!.find(r => r.LogicalResourceId === "OrdersTable")!.PhysicalResourceId!;
  inventoryTableName = resources.StackResources!.find(r => r.LogicalResourceId === "InventoryTable")!.PhysicalResourceId!;
});

async function apiRequest(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const url = `${apiUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function getOrderFromTable(orderId: string): Promise<Record<string, unknown> | null> {
  const result = await dynamodb.send(new GetItemCommand({
    TableName: ordersTableName,
    Key: marshall({ pk: `ORDER#${orderId}`, sk: "META" }),
  }));
  return result.Item ? unmarshall(result.Item) as Record<string, unknown> : null;
}

async function waitForExecution(orderId: string, timeoutMs = 30000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const executions = await sfn.send(new ListExecutionsCommand({
      stateMachineArn,
      maxResults: 20,
    }));
    const exec = executions.executions?.find(e => e.name === `order-${orderId}`);
    if (exec && exec.status !== "RUNNING") {
      return exec.status!;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Execution for order ${orderId} did not complete within ${timeoutMs}ms`);
}

async function createOrder(order: unknown): Promise<string> {
  const { body } = await apiRequest("POST", "/orders", order);
  const id = (body as Record<string, unknown>).id as string;
  createdOrderIds.push(id);
  return id;
}

async function cleanupOrders(): Promise<void> {
  for (const id of createdOrderIds) {
    await dynamodb.send(new DeleteItemCommand({
      TableName: ordersTableName,
      Key: marshall({ pk: `ORDER#${id}`, sk: "META" }),
    }));
  }

  // Clean up any inventory items created by the fulfillment workflow
  const inventoryScan = await dynamodb.send(new ScanCommand({
    TableName: inventoryTableName,
    Limit: 100,
  }));
  for (const item of inventoryScan.Items ?? []) {
    const key = { pk: item.pk, sk: item.sk };
    await dynamodb.send(new DeleteItemCommand({ TableName: inventoryTableName, Key: key }));
  }
}

describe("E-Commerce Integration Tests", () => {
  afterAll(async () => {
    await cleanupOrders();
  });

  describe("Orders API", () => {
    it("GET /orders returns a list", async () => {
      const { status, body } = await apiRequest("GET", "/orders");
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });

    it("POST /orders creates an order and starts fulfillment", async () => {
      const order = {
        items: [{ sku: "WIDGET-001", quantity: 2, price: 9.99 }],
        customer: { email: "test@example.com", address: "123 Main St" },
      };

      const { status, body } = await apiRequest("POST", "/orders", order);
      expect(status).toBe(201);

      const created = body as Record<string, unknown>;
      expect(created.id).toBeDefined();
      expect(created.status).toBe("PENDING");
      createdOrderIds.push(created.id as string);
      console.log(body);

      // Verify order is in DynamoDB
      const dbOrder = await getOrderFromTable(created.id as string);
      expect(dbOrder).not.toBeNull();
      expect(dbOrder!.status).toBe("PENDING");
      expect(dbOrder!.items).toEqual(order.items);
    });

    it("GET /orders/{id} retrieves a specific order", async () => {
      const orderId = await createOrder({
        items: [{ sku: "TEST-001", quantity: 1, price: 5.00 }],
        customer: { email: "get-test@example.com", address: "456 Oak Ave" },
      });

      // Retrieve it
      const { status, body } = await apiRequest("GET", `/orders/${orderId}`);
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).id).toBe(orderId);
    });

    it("GET /orders/{id} returns 404 for non-existent order", async () => {
      const { status } = await apiRequest("GET", "/orders/non-existent-id-12345");
      expect(status).toBe(404);
    });
  });

  describe("Order Fulfillment Workflow", () => {
    it("completes successfully for a valid order", async () => {
      const orderId = await createOrder({
        items: [{ sku: "WIDGET-001", quantity: 1, price: 9.99 }],
        customer: { email: "fulfill@example.com", address: "789 Pine Rd" },
      });

      const status = await waitForExecution(orderId);
      expect(status).toBe("SUCCEEDED");
    }, 60000);

    it("processes high-value orders through the hold path", async () => {
      const orderId = await createOrder({
        items: [{ sku: "EXPENSIVE", quantity: 1, price: 15000 }],
        customer: { email: "highvalue@example.com", address: "1 Rich St" },
      });

      const status = await waitForExecution(orderId);
      expect(status).toBe("SUCCEEDED");
    }, 60000);
  });

  describe("Product Catalog Service", () => {
    let catalogUrl: string;

    beforeAll(async () => {
      const stacks = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
      const outputs = stacks.Stacks![0].Outputs!;
      catalogUrl = `http://${outputs.find(o => o.OutputKey === "ProductCatalogUrl")!.OutputValue!}`;
    });

    it("ALB responds to requests", async () => {
      const res = await fetch(catalogUrl);
      expect(res.status).toBe(200);
    });
  });
});
