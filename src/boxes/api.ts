import { mkRestApi, mkApiGatewayResource, mkMethod, mkDeployment, mkStage } from "../generated/apigateway.js";
import type { RestApi, ApiGatewayResource } from "../generated/apigateway.js";
import { mkPermission } from "../generated/lambda.js";
import type { LambdaFunction } from "../generated/lambda.js";
import { ref, fnJoin, fnSub, deriveId, makeResource } from "../runtime/resource.js";
import { addDependency } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD" | "ANY";

export type RouteDefinition = {
  methods: HttpMethod[];
  handler: LambdaFunction;
};

export type CorsConfig = {
  allowOrigins?: string;
  allowMethods?: string;
  allowHeaders?: string;
};

export type ApiDefinition = {
  name: string;
  description?: string;
  stageName?: string;
  cors?: boolean | CorsConfig;
  routes: Record<string, RouteDefinition>;
};

export type Api = {
  readonly restApi: RestApi;
  readonly stageUrl: string;
};

export const mkApi = box(
  "mkApi",
  (logicalId: string, definition: ApiDefinition): Api => {
    const { name, description, stageName = "prod", cors, routes } = definition;
    const corsConfig: CorsConfig | null = cors
      ? (typeof cors === "object" ? cors : { allowOrigins: "*", allowMethods: "GET,POST,PUT,DELETE,OPTIONS", allowHeaders: "Content-Type,Authorization" })
      : null;

    const restApi = mkRestApi(logicalId, { name, description });

    const rootResourceId = restApi.rootResourceId;

    const lambdaUri = (handler: LambdaFunction) =>
      fnJoin("", [
        "arn:aws:apigateway:",
        fnSub("${AWS::Region}"),
        ":lambda:path/2015-03-31/functions/",
        handler.arn,
        "/invocations",
      ]);

    const permissionsCreated = new Set<string>();
    const pathResources = new Map<string, ApiGatewayResource>();
    const methodIds: string[] = [];

    for (const [path, route] of Object.entries(routes)) {
      const pathParts = path.replace(/^\//, "").split("/");
      let parentResource: ApiGatewayResource | null = null;
      let pathPrefix = "";

      for (const part of pathParts) {
        pathPrefix = pathPrefix ? `${pathPrefix}/${part}` : part;
        if (pathResources.has(pathPrefix)) {
          parentResource = pathResources.get(pathPrefix)!;
        } else {
          const resourceLogicalId = deriveId(restApi, pathPrefix.replace(/[^a-zA-Z0-9]/g, ""), "Resource");
          let resource: ApiGatewayResource;
          if (parentResource) {
            resource = mkApiGatewayResource(resourceLogicalId, {
              parentId: parentResource,
              pathPart: part,
              restApiId: restApi,
            });
          } else {
            // Root level: parentId is the RestApi's RootResourceId (a token string, not a resource)
            resource = makeResource("AWS::ApiGateway::Resource", resourceLogicalId, {
              parentId: rootResourceId,
              pathPart: part,
              restApiId: ref(restApi),
            }) as unknown as ApiGatewayResource;
          }
          parentResource = resource;
          pathResources.set(pathPrefix, resource);
        }
      }

      for (const method of route.methods) {
        const methodId = deriveId(restApi, pathParts.join("").replace(/[^a-zA-Z0-9]/g, ""), method);
        mkMethod(methodId, {
          httpMethod: method,
          resourceId: parentResource,
          restApiId: restApi,
          authorizationType: "NONE",
          integration: {
            type: "AWS_PROXY",
            integrationHttpMethod: "POST",
            uri: lambdaUri(route.handler),
          },
        } as any);
        methodIds.push(methodId);
      }

      // CORS: add OPTIONS method with MOCK integration returning allow headers
      if (corsConfig) {
        const optionsId = deriveId(restApi, pathParts.join("").replace(/[^a-zA-Z0-9]/g, ""), "OPTIONS");
        mkMethod(optionsId, {
          httpMethod: "OPTIONS",
          resourceId: parentResource,
          restApiId: restApi,
          authorizationType: "NONE",
          integration: {
            type: "MOCK",
            requestTemplates: { "application/json": '{"statusCode": 200}' },
            integrationResponses: [{
              statusCode: "200",
              responseParameters: {
                "method.response.header.Access-Control-Allow-Headers": `'${corsConfig.allowHeaders ?? "Content-Type,Authorization"}'`,
                "method.response.header.Access-Control-Allow-Methods": `'${corsConfig.allowMethods ?? "GET,POST,PUT,DELETE,OPTIONS"}'`,
                "method.response.header.Access-Control-Allow-Origin": `'${corsConfig.allowOrigins ?? "*"}'`,
              },
            }],
          },
          methodResponses: [{
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Headers": true,
              "method.response.header.Access-Control-Allow-Methods": true,
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          }],
        } as any);
        methodIds.push(optionsId);
      }

      const handlerId = route.handler.logicalId;
      if (!permissionsCreated.has(handlerId)) {
        permissionsCreated.add(handlerId);
        mkPermission(deriveId(restApi, handlerId, "InvokePermission"), {
          action: "lambda:InvokeFunction",
          functionName: ref(route.handler),
          principal: "apigateway.amazonaws.com",
          sourceArn: fnJoin("", [
            "arn:aws:execute-api:",
            fnSub("${AWS::Region}"),
            ":",
            fnSub("${AWS::AccountId}"),
            ":",
            ref(restApi),
            "/*",
          ]),
        } as any);
      }
    }

    const deploymentId = deriveId(restApi, "Deployment");
    const deployment = mkDeployment(deploymentId, {
      restApiId: restApi,
    } as any);

    for (const mId of methodIds) {
      addDependency(deploymentId, mId);
    }

    mkStage(deriveId(restApi, "Stage"), {
      restApiId: ref(restApi),
      deploymentId: deployment,
      stageName,
    } as any);

    const stageUrl = fnJoin("", [
      "https://",
      ref(restApi),
      ".execute-api.",
      fnSub("${AWS::Region}"),
      ".amazonaws.com/",
      stageName,
    ]);

    return { restApi, stageUrl };
  },
);

// === Authorizers ===

import { mkAuthorizer } from "../generated/apigateway.js";
import type { Authorizer, DomainName as ApiDomainName, ApiKey, UsagePlan, UsagePlanKey, BasePathMapping } from "../generated/apigateway.js";
import { mkDomainName, mkBasePathMapping, mkApiKey, mkUsagePlan, mkUsagePlanKey } from "../generated/apigateway.js";
import type { UserPool } from "../generated/cognito.js";
import type { Certificate } from "../generated/certificatemanager.js";
import type { HostedZone } from "../generated/route53.js";
import { mkRecordSet } from "../generated/route53.js";
import type { RecordSet } from "../generated/route53.js";

/**
 * Attaches a Cognito User Pool authorizer to a REST API.
 * Returns the Authorizer resource (pass its ID to routes that require auth).
 */
export const addCognitoAuthorizer = box(
  "addCognitoAuthorizer",
  (restApi: RestApi, logicalId: string, userPools: UserPool[]): Authorizer => {
    return mkAuthorizer(logicalId, {
      restApiId: restApi,
      type: "COGNITO_USER_POOLS",
      name: logicalId,
      providerARNs: userPools.map((pool) => pool.arn),
      identitySource: "method.request.header.Authorization",
    });
  },
);

/**
 * Attaches a Lambda authorizer (token or request-based) to a REST API.
 * Creates the Authorizer resource and a Permission for API Gateway to invoke
 * the authorizer function.
 */
export const addLambdaAuthorizer = box(
  "addLambdaAuthorizer",
  (restApi: RestApi, logicalId: string, fn: LambdaFunction, type: "TOKEN" | "REQUEST" = "TOKEN"): Authorizer => {
    const authorizerUri = fnJoin("", [
      "arn:aws:apigateway:",
      fnSub("${AWS::Region}"),
      ":lambda:path/2015-03-31/functions/",
      fn.arn,
      "/invocations",
    ]);

    const authorizer = mkAuthorizer(logicalId, {
      restApiId: restApi,
      type,
      name: logicalId,
      authorizerUri,
      identitySource: type === "TOKEN"
        ? "method.request.header.Authorization"
        : undefined,
    });

    mkPermission(deriveId(restApi, logicalId, "InvokePermission"), {
      functionName: ref(fn),
      action: "lambda:InvokeFunction",
      principal: "apigateway.amazonaws.com",
      sourceArn: fnJoin("", [
        "arn:aws:execute-api:",
        fnSub("${AWS::Region}"),
        ":",
        fnSub("${AWS::AccountId}"),
        ":",
        ref(restApi),
        "/authorizers/",
        authorizer.authorizerId,
      ]),
    } as any);

    return authorizer;
  },
);

// === Usage plans & API keys ===

export type UsagePlanConfig = {
  name: string;
  description?: string;
  throttle?: { rateLimit: number; burstLimit: number };
  quota?: { limit: number; period: "DAY" | "WEEK" | "MONTH" };
};

export type ApiKeyAndPlan = {
  readonly apiKey: ApiKey;
  readonly usagePlan: UsagePlan;
  readonly usagePlanKey: UsagePlanKey;
};

/**
 * Creates a usage plan with throttling/quota and an API key bound to it.
 * Wires the plan to the given REST API's stage.
 */
export const addUsagePlan = box(
  "addUsagePlan",
  (restApi: RestApi, logicalId: string, config: UsagePlanConfig, stageName: string = "prod"): ApiKeyAndPlan => {
    const usagePlan = mkUsagePlan(`${logicalId}Plan`, {
      usagePlanName: config.name,
      description: config.description,
      throttle: config.throttle ? {
        rateLimit: config.throttle.rateLimit,
        burstLimit: config.throttle.burstLimit,
      } : undefined,
      quota: config.quota ? {
        limit: config.quota.limit,
        period: config.quota.period,
      } : undefined,
      apiStages: [{
        apiId: ref(restApi),
        stage: stageName,
      }] as any,
    });

    const apiKey = mkApiKey(`${logicalId}Key`, {
      enabled: true,
      name: `${config.name}-key`,
    });

    const usagePlanKey = mkUsagePlanKey(`${logicalId}PlanKey`, {
      keyType: "API_KEY",
      usagePlanId: usagePlan,
      keyId: apiKey,
    });

    return { apiKey, usagePlan, usagePlanKey };
  },
);

// === Custom domain ===

export type CustomDomainConfig = {
  domainName: string;
  certificate: Certificate;
  hostedZone: HostedZone;
  basePath?: string;
};

export type CustomDomain = {
  readonly domain: ApiDomainName;
  readonly mapping: BasePathMapping;
  readonly record: RecordSet;
};

/**
 * Attaches a custom domain name to a REST API with an ACM certificate and
 * Route53 alias record. Creates DomainName, BasePathMapping, and RecordSet.
 */
export const addCustomDomain = box(
  "addCustomDomain",
  (restApi: RestApi, logicalId: string, config: CustomDomainConfig, stageName: string = "prod"): CustomDomain => {
    const domain = mkDomainName(`${logicalId}Domain`, {
      domainName: config.domainName,
      regionalCertificateArn: ref(config.certificate),
      endpointConfiguration: { types: ["REGIONAL"] } as any,
    });

    const mapping = mkBasePathMapping(`${logicalId}Mapping`, {
      domainName: config.domainName,
      restApiId: restApi,
      stage: stageName,
      basePath: config.basePath,
    });

    const record = mkRecordSet(deriveId(restApi, "AliasRecord"), {
      hostedZoneId: config.hostedZone.id,
      name: config.domainName,
      type: "A",
      aliasTarget: {
        dnsName: domain.regionalDomainName,
        hostedZoneId: domain.regionalHostedZoneId,
      },
    } as any);

    return { domain, mapping, record };
  },
);
