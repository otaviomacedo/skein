import { mkRestApi, mkApiGatewayResource, mkMethod, mkDeployment, mkStage, RestApi, ApiGatewayResource } from "../generated/apigateway.js";
import { mkPermission } from "../generated/lambda.js";
import { LambdaFunction } from "../generated/lambda.js";
import { ref, fnJoin, fnSub, deriveId, makeResource } from "../runtime/resource.js";
import { addDependency } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD" | "ANY";

export type RouteDefinition = {
  methods: HttpMethod[];
  handler: LambdaFunction;
};

export type ApiDefinition = {
  name: string;
  description?: string;
  stageName?: string;
  routes: Record<string, RouteDefinition>;
};

export type Api = {
  readonly restApi: RestApi;
  readonly stageUrl: string;
};

export const mkApi = box(
  "mkApi",
  (logicalId: string, definition: ApiDefinition): Api => {
    const { name, description, stageName = "prod", routes } = definition;

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
