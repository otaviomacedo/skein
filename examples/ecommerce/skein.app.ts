/**
 * E-Commerce Order Processing Platform
 *
 * Architecture:
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ VPC (10.0.0.0/16)                                                   │
 *   │   Public Subnets  → ALB → Product Catalog (Fargate)                 │
 *   │   Private Subnets → Product Catalog containers                      │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 *   Orders API (API Gateway + Lambda + DynamoDB)
 *     POST /orders → triggers order fulfillment workflow
 *     GET  /orders, /orders/{id}
 *
 *   Order Fulfillment (Step Functions):
 *     Validate → Charge Payment → Reserve Inventory → Send Confirmation
 *     On success → publish to "OrderFulfilled" SNS topic
 *
 *   OrderFulfilled SNS → fan-out:
 *     • Warehouse notification Lambda
 *     • Analytics recording Lambda
 *
 *   DLQ monitoring:
 *     Failed orders → DLQ → DLQ processor Lambda → failed-orders table
 *     DLQ depth alarm → ops notification SNS
 */

import { mkTable } from "../../src/generated/dynamodb.js";
import { mkTopic } from "../../src/generated/sns.js";
import { ref } from "../../src/runtime/resource.js";
import { output } from "../../src/runtime/outputs.js";
import { mkAsset, mkDockerAsset, setAssetEnvironment } from "../../src/runtime/assets.js";
import { mkLambda } from "../../src/boxes/lambda-helpers.js";
import { crudApi } from "../../src/boxes/crud-api.js";
import { snsFanout } from "../../src/boxes/sns-fanout.js";
import { vpc } from "../../src/boxes/vpc.js";
import { fargateService } from "../../src/boxes/fargate.js";
import { orderFulfillment } from "./boxes/order-fulfillment.js";

// ═══════════════════════════════════════════════════════════════════════════
// Networking
// ═══════════════════════════════════════════════════════════════════════════

const { vpc: vpcResource, publicSubnets, privateSubnets } = vpc("Ecommerce", {
  cidrBlock: "10.0.0.0/16",
  availabilityZones: ["us-east-1a", "us-east-1b"],
  publicSubnetCidrs: ["10.0.1.0/24", "10.0.2.0/24"],
  privateSubnetCidrs: ["10.0.10.0/24", "10.0.11.0/24"],
});

// ═══════════════════════════════════════════════════════════════════════════
// Data stores
// ═══════════════════════════════════════════════════════════════════════════

const ordersTable = mkTable("OrdersTable", {
  attributeDefinitions: [
    { attributeName: "pk", attributeType: "S" },
    { attributeName: "sk", attributeType: "S" },
  ],
  keySchema: [
    { attributeName: "pk", keyType: "HASH" },
    { attributeName: "sk", keyType: "RANGE" },
  ],
  billingMode: "PAY_PER_REQUEST",
});

const inventoryTable = mkTable("InventoryTable", {
  attributeDefinitions: [
    { attributeName: "pk", attributeType: "S" },
    { attributeName: "sk", attributeType: "S" },
  ],
  keySchema: [
    { attributeName: "pk", keyType: "HASH" },
    { attributeName: "sk", keyType: "RANGE" },
  ],
  billingMode: "PAY_PER_REQUEST",
});

// ═══════════════════════════════════════════════════════════════════════════
// Messaging
// ═══════════════════════════════════════════════════════════════════════════

const orderFulfilledTopic = mkTopic("OrderFulfilledTopic", {
  topicName: "order-fulfilled",
});

const opsAlertTopic = mkTopic("OpsAlertTopic", {
  topicName: "ops-alerts",
});


// ═══════════════════════════════════════════════════════════════════════════
// Asset environment (determines S3 bucket and ECR repo names)
// ═══════════════════════════════════════════════════════════════════════════

setAssetEnvironment({
  account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? "000000000000",
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1",
});

// ═══════════════════════════════════════════════════════════════════════════
// Assets (Lambda code bundles)
// ═══════════════════════════════════════════════════════════════════════════

const handlersDir = new URL("./handlers/", import.meta.url).pathname;
const ordersApiCode = mkAsset("OrdersApiCode", { type: "file", path: `${handlersDir}orders-api.ts` });
const validateCode = mkAsset("ValidateCode", { type: "file", path: `${handlersDir}validate-order.ts` });
const chargeCode = mkAsset("ChargeCode", { type: "file", path: `${handlersDir}charge-payment.ts` });
const reserveCode = mkAsset("ReserveCode", { type: "file", path: `${handlersDir}reserve-inventory.ts` });
const confirmCode = mkAsset("ConfirmCode", { type: "file", path: `${handlersDir}send-confirmation.ts` });
const warehouseCode = mkAsset("WarehouseCode", { type: "file", path: `${handlersDir}notify-warehouse.ts` });
const analyticsCode = mkAsset("AnalyticsCode", { type: "file", path: `${handlersDir}notify-analytics.ts` });
const notifyFulfilledCode = mkAsset("NotifyFulfilledCode", { type: "file", path: `${handlersDir}notify-fulfilled.ts` });
const startFulfillmentCode = mkAsset("StartFulfillmentCode", { type: "file", path: `${handlersDir}start-fulfillment.ts` });
const dlqCode = mkAsset("DLQCode", { type: "file", path: `${handlersDir}dlq-processor.ts` });

// ═══════════════════════════════════════════════════════════════════════════
// Orders API (CRUD)
// ═══════════════════════════════════════════════════════════════════════════

const { handler: ordersHandler, stageUrl } = crudApi("Orders", {
  table: ordersTable,
  routes: {
    "/orders": ["GET", "POST"],
    "/orders/{id}": ["GET"],
  },
  functionProps: {
    runtime: "nodejs20.x",
    handler: "index.handler",
    code: { s3Bucket: ordersApiCode.s3Bucket, s3Key: ordersApiCode.s3Key },
    timeout: 30,
    memorySize: 256,
  },
  description: "Orders REST API",
});

// ═══════════════════════════════════════════════════════════════════════════
// Order Fulfillment Workflow (Step Functions)
// ═══════════════════════════════════════════════════════════════════════════

const { stateMachine } = orderFulfillment("OrderFulfillment", {
  ordersTable,
  inventoryTable,
  fulfilledTopic: orderFulfilledTopic,
  opsAlertTopic,
  apiHandler: ordersHandler,
  validateCode,
  chargeCode,
  reserveCode,
  confirmCode,
  notifyFulfilledCode,
  consumerCode: startFulfillmentCode,
  dlqProcessorCode: dlqCode,
});

// ═══════════════════════════════════════════════════════════════════════════
// Post-Fulfillment Fan-Out (SNS → multiple consumers)
// ═══════════════════════════════════════════════════════════════════════════

const warehouseFn = mkLambda("NotifyWarehouse", {
  runtime: "nodejs20.x",
  handler: "index.handler",
  code: { s3Bucket: warehouseCode.s3Bucket, s3Key: warehouseCode.s3Key },
  timeout: 10,
  memorySize: 128,
});

const analyticsFn = mkLambda("NotifyAnalytics", {
  runtime: "nodejs20.x",
  handler: "index.handler",
  code: { s3Bucket: analyticsCode.s3Bucket, s3Key: analyticsCode.s3Key },
  timeout: 10,
  memorySize: 128,
});

snsFanout(orderFulfilledTopic, [warehouseFn, analyticsFn]);


// ═══════════════════════════════════════════════════════════════════════════
// Product Catalog (Fargate)
// ═══════════════════════════════════════════════════════════════════════════

const productCatalogImage = mkDockerAsset("ProductCatalogImage", `${handlersDir}`, {
  file: "Dockerfile",
});

const { alb } = fargateService("ProductCatalog", {
  vpc: vpcResource,
  subnets: privateSubnets,
  albSubnets: publicSubnets,
  container: {
    image: productCatalogImage.imageUri,
    port: 80,
    environment: {
      NODE_ENV: "production",
      INVENTORY_TABLE: ref(inventoryTable),
    },
  },
  desiredCount: 2,
  cpu: "256",
  memory: "512",
});

// ═══════════════════════════════════════════════════════════════════════════
// Outputs
// ═══════════════════════════════════════════════════════════════════════════

output("OrdersApiUrl", stageUrl);
output("ProductCatalogUrl", alb.dnsName);
output("OrderFulfillmentArn", stateMachine.arn);
