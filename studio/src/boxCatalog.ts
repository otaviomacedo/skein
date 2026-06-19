export type CatalogBox = {
  name: string;
  category: string;
  description: string;
  inputs: string[];
  outputs: string[];
  /** Actual parameter names for code generation (maps to input ports) */
  paramNames?: string[];
  /** Which input indices accept arrays (multiple connections) */
  arrayInputs?: number[];
};

export type CatalogSection = {
  source: string;
  boxes: CatalogBox[];
};

export const catalog: CatalogSection[] = [
  {
    source: "App: E-Commerce",
    boxes: [
      { name: "orderFulfillment", category: "Workflows", description: "Order fulfillment subsystem (queue, workflow, DLQ)", inputs: ["Table", "Table", "Topic", "Topic", "Function", "Asset", "Asset", "Asset", "Asset", "Asset", "Asset", "Asset"], outputs: ["stateMachine"], paramNames: ["ordersTable", "inventoryTable", "fulfilledTopic", "opsAlertTopic", "apiHandler", "validateCode", "chargeCode", "reserveCode", "confirmCode", "notifyFulfilledCode", "consumerCode", "dlqProcessorCode"] },
    ],
  },
  {
    source: "Patterns",
    boxes: [
      { name: "crudApi", category: "API", description: "REST API + Lambda + DynamoDB table grants", inputs: ["Table", "props"], outputs: ["handler", "restApi"], paramNames: ["table", "props"] },
      { name: "vpc", category: "Networking", description: "VPC with public/private subnets, IGW, NAT", inputs: ["props"], outputs: ["vpc", "publicSubnets", "privateSubnets"] },
      { name: "fargateService", category: "Containers", description: "Fargate service behind an ALB", inputs: ["VPC", "Subnets", "Subnets", "props"], outputs: ["cluster", "service", "alb"], paramNames: ["vpc", "subnets", "albSubnets", "container"] },
      { name: "stepFunctionsPipeline", category: "Workflows", description: "Step Functions state machine from step definitions", inputs: ["props"], outputs: ["stateMachine", "role"] },
      { name: "snsFanout", category: "Messaging", description: "Subscribe multiple Lambdas to an SNS topic", inputs: ["Topic", "Function[]"], outputs: ["subscriptions"], paramNames: ["topic", "handlers"], arrayInputs: [1] },
      { name: "scheduledProcessor", category: "Compute", description: "Lambda on a schedule with table + queue", inputs: ["Table", "Queue", "props"], outputs: ["Function"], paramNames: ["table", "failureQueue", "functionProps"] },
      { name: "queueProcessor", category: "Compute", description: "Lambda triggered from SQS with table access", inputs: ["Table", "Queue", "props"], outputs: ["Function"], paramNames: ["table", "queue", "functionProps"] },
    ],
  },
  {
    source: "Compute",
    boxes: [
      { name: "mkLambda", category: "Lambda", description: "Lambda function with execution role", inputs: ["props"], outputs: ["Function"], paramNames: ["props"] },
      { name: "addEnvironment", category: "Lambda", description: "Add an environment variable", inputs: ["Function"], outputs: ["Function"], paramNames: ["fn"] },
      { name: "setTimeout", category: "Lambda", description: "Set function timeout", inputs: ["Function"], outputs: ["Function"], paramNames: ["fn"] },
      { name: "setMemorySize", category: "Lambda", description: "Set function memory", inputs: ["Function"], outputs: ["Function"], paramNames: ["fn"] },
      { name: "onSchedule", category: "Events", description: "Trigger function on a cron schedule", inputs: ["Function", "schedule"], outputs: ["Function", "Rule"], paramNames: ["fn", "schedule"] },
      { name: "onEvent", category: "Events", description: "Trigger function on an event pattern", inputs: ["Function", "pattern"], outputs: ["Function", "Rule"], paramNames: ["fn", "pattern"] },
    ],
  },
  {
    source: "Storage",
    boxes: [
      { name: "encrypt", category: "S3", description: "Enable server-side encryption", inputs: ["Bucket"], outputs: ["Bucket"] },
      { name: "enableVersioning", category: "S3", description: "Enable versioning", inputs: ["Bucket"], outputs: ["Bucket"] },
      { name: "enableWebHosting", category: "S3", description: "Enable static website hosting", inputs: ["Bucket"], outputs: ["Bucket"] },
      { name: "blockPublicAccess", category: "S3", description: "Block all public access", inputs: ["Bucket"], outputs: ["Bucket"] },
      { name: "grantTableReadWrite", category: "DynamoDB", description: "Grant Lambda read/write access to a table", inputs: ["Function", "Table"], outputs: ["Function", "Table", "Policy"] },
      { name: "grantTableRead", category: "DynamoDB", description: "Grant Lambda read access to a table", inputs: ["Function", "Table"], outputs: ["Function", "Table", "Policy"] },
    ],
  },
  {
    source: "Messaging",
    boxes: [
      { name: "grantSendMessage", category: "SQS", description: "Grant Lambda permission to send to a queue", inputs: ["Function", "Queue"], outputs: ["Function", "Queue", "Policy"] },
      { name: "triggerFromQueue", category: "SQS", description: "Trigger Lambda from an SQS queue", inputs: ["Function", "Queue"], outputs: ["Function", "Queue", "Mapping", "Policy"] },
      { name: "withDLQ", category: "SQS", description: "Attach a dead-letter queue", inputs: ["Queue", "DLQ"], outputs: ["Queue", "DLQ"] },
      { name: "grantPublish", category: "SNS", description: "Grant Lambda permission to publish to a topic", inputs: ["Function", "Topic"], outputs: ["Function", "Topic", "Policy"] },
      { name: "alarmOnMetric", category: "CloudWatch", description: "Create an alarm on a metric", inputs: ["props"], outputs: ["Alarm"] },
      { name: "notifyOnAlarm", category: "CloudWatch", description: "Send alarm notifications to SNS", inputs: ["Alarm", "Topic"], outputs: ["Alarm", "Topic"] },
    ],
  },
  {
    source: "Networking",
    boxes: [
      { name: "attachInternetGateway", category: "VPC", description: "Attach an IGW to a VPC", inputs: ["VPC"], outputs: ["IGW"] },
      { name: "publicRouteTable", category: "VPC", description: "Route table with 0.0.0.0/0 → IGW", inputs: ["VPC", "IGW"], outputs: ["RouteTable"] },
      { name: "natRouteTable", category: "VPC", description: "Route table with NAT gateway", inputs: ["VPC", "Subnet"], outputs: ["RouteTable", "NAT", "EIP"] },
      { name: "associateRouteTable", category: "VPC", description: "Associate a subnet with a route table", inputs: ["Subnet", "RouteTable"], outputs: ["Subnet", "RouteTable"] },
    ],
  },
  {
    source: "IAM & Security",
    boxes: [
      { name: "grantRead", category: "IAM", description: "Grant Lambda read access to S3 bucket", inputs: ["Function", "Bucket"], outputs: ["Function", "Bucket", "Policy"] },
      { name: "grantWrite", category: "IAM", description: "Grant Lambda write access to S3 bucket", inputs: ["Function", "Bucket"], outputs: ["Function", "Bucket", "Policy"] },
      { name: "grantStartExecution", category: "Step Functions", description: "Grant Lambda permission to start a state machine", inputs: ["Function", "StateMachine"], outputs: ["Function", "StateMachine", "Policy"] },
      { name: "taskExecutionRole", category: "ECS", description: "ECS task execution role", inputs: [], outputs: ["Role"] },
      { name: "taskRole", category: "ECS", description: "ECS task role (empty, add grants)", inputs: [], outputs: ["Role"] },
    ],
  },
];
