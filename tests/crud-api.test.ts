import { describe, it, expect } from "vitest";
import { synthTest, hasResource, resourceOfType } from "../src/testing/index.js";
import { mkTable } from "../src/generated/dynamodb.js";
import { crudApi } from "../src/boxes/crud-api.js";

describe("crudApi", () => {
  it("produces handler, API gateway, and grants for an external table", () => {
    const template = synthTest(() => {
      const table = mkTable("ItemsTable", {
        attributeDefinitions: [
          { attributeName: "pk", attributeType: "S" },
        ],
        keySchema: [
          { attributeName: "pk", keyType: "HASH" },
        ],
        billingMode: "PAY_PER_REQUEST",
      });

      crudApi("Items", {
        table,
        routes: {
          "/items": ["GET", "POST"],
          "/items/{id}": ["GET", "PUT", "DELETE"],
        },
        functionProps: {
          runtime: "nodejs20.x",
          handler: "index.handler",
          code: { s3Bucket: "code-bucket", s3Key: "handler.zip" },
        },
        description: "Items CRUD API",
      });
    });

    expect(hasResource(template, "ItemsTable", { type: "AWS::DynamoDB::Table" })).toBe(true);
    expect(hasResource(template, "ItemsHandler", { type: "AWS::Lambda::Function" })).toBe(true);
    expect(hasResource(template, "Items", { type: "AWS::ApiGateway::RestApi" })).toBe(true);

    // Should have IAM policy for table access
    const policies = resourceOfType(template, "AWS::IAM::Policy");
    expect(policies.length).toBeGreaterThanOrEqual(1);

    // Should have methods for all routes
    const methods = resourceOfType(template, "AWS::ApiGateway::Method");
    expect(methods.length).toBe(5); // GET+POST on /items, GET+PUT+DELETE on /items/{id}
  });

  it("returns typed outputs", () => {
    synthTest(() => {
      const table = mkTable("ThingsTable", {
        attributeDefinitions: [
          { attributeName: "id", attributeType: "S" },
        ],
        keySchema: [
          { attributeName: "id", keyType: "HASH" },
        ],
        billingMode: "PAY_PER_REQUEST",
      });

      const result = crudApi("Things", {
        table,
        routes: {
          "/things": ["GET"],
        },
        functionProps: {
          runtime: "nodejs20.x",
          handler: "index.handler",
          code: { s3Bucket: "bucket", s3Key: "code.zip" },
        },
      });

      expect(result.handler.logicalId).toBe("ThingsHandler");
      expect(result.restApi.logicalId).toBe("Things");
      expect(typeof result.stageUrl).toBe("string");
    });
  });
});