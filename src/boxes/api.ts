import { mkRestApi, mkApiGatewayResource, mkMethod, mkDeployment, mkStage, RestApi } from "../generated/apigateway.js";
import { mkPermission } from "../generated/lambda.js";
import { LambdaFunction } from "../generated/lambda.js";
import { ref, fnJoin, fnSub, deriveId } from "../runtime/resource.js";
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
    const pathResources = new Map<string, string>();

    for (const [path, route] of Object.entries(routes)) {
      const pathParts = path.replace(/^\//, "").split("/");
      let parentId: string = rootResourceId;
      let pathPrefix = "";

      for (const part of pathParts) {
        pathPrefix = pathPrefix ? `${pathPrefix}/${part}` : part;
        if (pathResources.has(pathPrefix)) {
          parentId = pathResources.get(pathPrefix)!;
        } else {
          const resourceId = deriveId(restApi, pathPrefix.replace(/[^a-zA-Z0-9]/g, ""), "Resource");
          const resource = mkApiGatewayResource(resourceId, {
            parentId,
            pathPart: part,
            restApiId: ref(restApi),
          } as any);
          parentId = ref(resource);
          pathResources.set(pathPrefix, parentId);
        }
      }

      for (const method of route.methods) {
        const methodId = deriveId(restApi, pathParts.join(""), method);
        mkMethod(methodId, {
          httpMethod: method,
          resourceId: parentId,
          restApiId: ref(restApi),
          authorizationType: "NONE",
          integration: {
            type: "AWS_PROXY",
            integrationHttpMethod: "POST",
            uri: lambdaUri(route.handler),
          },
        } as any);
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

    const deployment = mkDeployment(deriveId(restApi, "Deployment"), {
      restApiId: ref(restApi),
    } as any);

    mkStage(deriveId(restApi, "Stage"), {
      restApiId: ref(restApi),
      deploymentId: ref(deployment),
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
