import { describe, expect, it } from "vitest";
import { resourceOfType, synthTest } from "../src/testing/index.js";
import { mkSecurityGroup, mkSubnet, mkVPC } from "../src/generated/ec2.js";
import { mkUserPool } from "../src/generated/cognito.js";
import { mkCertificate } from "../src/generated/certificatemanager.js";
import { mkHostedZone } from "../src/generated/route53.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import { fargateService, } from "../src/boxes/fargate.js";
import { addCognitoAuthorizer, addCustomDomain, addLambdaAuthorizer, addUsagePlan, mkApi, } from "../src/boxes/api.js";

// === Helper factories ===

function makeLambda(id: string) {
  return mkLambda(id, {
    runtime: "nodejs20.x",
    handler: "index.handler",
    code: { s3Bucket: "code-bucket", s3Key: `${id.toLowerCase()}.zip` },
  });
}

function makeVpc() {
  const vpcResource = mkVPC("TestVPC", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
  });
  const subnetA = mkSubnet("SubnetA", {
    vpcId: vpcResource,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: "us-east-1a",
  });
  const subnetB = mkSubnet("SubnetB", {
    vpcId: vpcResource,
    cidrBlock: "10.0.2.0/24",
    availabilityZone: "us-east-1b",
  });
  const sg = mkSecurityGroup("TestSG", {
    groupDescription: "test sg",
    vpcId: vpcResource,
  });
  return { vpcResource, subnetA, subnetB, sg };
}

function makeFargateService() {
  const vpcResource = mkVPC("FgVPC", {
    cidrBlock: "10.0.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
  });
  const pubA = mkSubnet("FgPubA", { vpcId: vpcResource, cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a" });
  const pubB = mkSubnet("FgPubB", { vpcId: vpcResource, cidrBlock: "10.0.2.0/24", availabilityZone: "us-east-1b" });
  const privA = mkSubnet("FgPrivA", { vpcId: vpcResource, cidrBlock: "10.0.10.0/24", availabilityZone: "us-east-1a" });
  const privB = mkSubnet("FgPrivB", { vpcId: vpcResource, cidrBlock: "10.0.11.0/24", availabilityZone: "us-east-1b" });

  return fargateService("Svc", {
    vpc: vpcResource,
    subnets: [privA, privB],
    albSubnets: [pubA, pubB],
    container: { image: "nginx:latest", port: 80 },
  });
}

// ==========================================================================
// S3 boxes
// ==========================================================================


describe("api/mkApi with cors", () => {
  it("creates OPTIONS methods for CORS-enabled routes", () => {
    const template = synthTest(() => {
      const handler = makeLambda("ApiHandler");
      mkApi("MyApi", {
        name: "TestApi",
        cors: true,
        routes: {
          "/items": { methods: ["GET", "POST"], handler },
        },
      });
    });

    const methods = resourceOfType(template, "AWS::ApiGateway::Method");
    // GET + POST + OPTIONS = 3
    const httpMethods = methods.map((m) => (m.Properties as any).HttpMethod);
    expect(httpMethods).toContain("OPTIONS");
    expect(httpMethods).toContain("GET");
    expect(httpMethods).toContain("POST");
  });

  it("creates REST API without CORS when cors is false/undefined", () => {
    const template = synthTest(() => {
      const handler = makeLambda("NoCorsHandler");
      mkApi("NoCorsApi", {
        name: "NoCorsApi",
        routes: {
          "/data": { methods: ["GET"], handler },
        },
      });
    });

    const methods = resourceOfType(template, "AWS::ApiGateway::Method");
    const httpMethods = methods.map((m) => (m.Properties as any).HttpMethod);
    expect(httpMethods).not.toContain("OPTIONS");
  });
});

describe("api/addCognitoAuthorizer", () => {
  it("creates a Cognito user pool authorizer", () => {
    const template = synthTest(() => {
      const handler = makeLambda("CogFn");
      const { restApi } = mkApi("CogApi", {
        name: "CogApi",
        routes: { "/secure": { methods: ["GET"], handler } },
      });
      const pool = mkUserPool("TestPool", {});
      addCognitoAuthorizer(restApi, "CogAuth", [pool]);
    });

    const authorizers = resourceOfType(template, "AWS::ApiGateway::Authorizer");
    expect(authorizers.length).toBe(1);
    expect((authorizers[0].Properties as any).Type).toBe("COGNITO_USER_POOLS");
  });
});

describe("api/addLambdaAuthorizer", () => {
  it("creates a TOKEN lambda authorizer with permission", () => {
    const template = synthTest(() => {
      const handler = makeLambda("ApiFn");
      const { restApi } = mkApi("AuthApi", {
        name: "AuthApi",
        routes: { "/resource": { methods: ["GET"], handler } },
      });
      const authFn = makeLambda("AuthorizerFn");
      addLambdaAuthorizer(restApi, "LambdaAuth", authFn, "TOKEN");
    });

    const authorizers = resourceOfType(template, "AWS::ApiGateway::Authorizer");
    expect(authorizers.length).toBe(1);
    expect((authorizers[0].Properties as any).Type).toBe("TOKEN");

    // 2 permissions: one for the API handler, one for the authorizer
    const permissions = resourceOfType(template, "AWS::Lambda::Permission");
    expect(permissions.length).toBe(2);
  });

  it("creates a REQUEST type authorizer", () => {
    const template = synthTest(() => {
      const handler = makeLambda("ReqFn");
      const { restApi } = mkApi("ReqApi", {
        name: "ReqApi",
        routes: { "/data": { methods: ["POST"], handler } },
      });
      const authFn = makeLambda("ReqAuth");
      addLambdaAuthorizer(restApi, "ReqAuthorizer", authFn, "REQUEST");
    });

    const authorizers = resourceOfType(template, "AWS::ApiGateway::Authorizer");
    expect((authorizers[0].Properties as any).Type).toBe("REQUEST");
  });
});

describe("api/addUsagePlan", () => {
  it("creates usage plan, API key, and binds them", () => {
    const template = synthTest(() => {
      const handler = makeLambda("PlanFn");
      const { restApi } = mkApi("PlanApi", {
        name: "PlanApi",
        routes: { "/items": { methods: ["GET"], handler } },
      });
      addUsagePlan(restApi, "Basic", {
        name: "BasicPlan",
        throttle: { rateLimit: 100, burstLimit: 50 },
        quota: { limit: 10000, period: "MONTH" },
      });
    });

    const plans = resourceOfType(template, "AWS::ApiGateway::UsagePlan");
    expect(plans.length).toBe(1);
    expect((plans[0].Properties as any).Throttle.RateLimit).toBe(100);
    expect((plans[0].Properties as any).Quota.Limit).toBe(10000);
    expect((plans[0].Properties as any).Quota.Period).toBe("MONTH");

    const keys = resourceOfType(template, "AWS::ApiGateway::ApiKey");
    expect(keys.length).toBe(1);
    expect((keys[0].Properties as any).Enabled).toBe(true);

    const planKeys = resourceOfType(template, "AWS::ApiGateway::UsagePlanKey");
    expect(planKeys.length).toBe(1);
  });
});

describe("api/addCustomDomain", () => {
  it("creates domain name, base path mapping, and Route53 record", () => {
    const template = synthTest(() => {
      const handler = makeLambda("DomainFn");
      const { restApi } = mkApi("DomainApi", {
        name: "DomainApi",
        routes: { "/api": { methods: ["GET"], handler } },
      });
      const cert = mkCertificate("MyCert", { domainName: "api.example.com" });
      const zone = mkHostedZone("MyZone", { name: "example.com" });
      addCustomDomain(restApi, "Custom", {
        domainName: "api.example.com",
        certificate: cert,
        hostedZone: zone,
      });
    });

    const domains = resourceOfType(template, "AWS::ApiGateway::DomainName");
    expect(domains.length).toBe(1);
    expect((domains[0].Properties as any).DomainName).toBe("api.example.com");

    const mappings = resourceOfType(template, "AWS::ApiGateway::BasePathMapping");
    expect(mappings.length).toBe(1);

    const records = resourceOfType(template, "AWS::Route53::RecordSet");
    expect(records.length).toBe(1);
    expect((records[0].Properties as any).Type).toBe("A");
  });
});

