// User-facing re-exports with friendly names and typed references

// S3
export { Bucket, BucketProps, mkBucket, getBucketAtt } from "../generated/s3.js";

// IAM
export { Role, RoleProps, mkRole, getRoleAtt, Policy, PolicyProps, mkPolicy } from "../generated/iam.js";

// Lambda (with typed role reference)
export { Function, FunctionProps, mkFunction } from "./lambda.js";
export { EventSourceMapping, mkEventSourceMapping } from "../generated/lambda.js";
export { Permission, mkPermission } from "../generated/lambda.js";

// DynamoDB
export { Table, TableProps, mkTable, getTableAtt } from "../generated/dynamodb.js";

// SQS
export { Queue, QueueProps, mkQueue, getQueueAtt } from "../generated/sqs.js";

// CloudFront
export { Distribution, DistributionProps, mkDistribution, getDistributionAtt } from "../generated/cloudfront.js";
export {
  CloudFrontOriginAccessIdentity as OAI,
  CloudFrontOriginAccessIdentityProps as OAIProps,
  mkCloudFrontOriginAccessIdentity as mkOAI,
} from "../generated/cloudfront.js";

// ACM
export { Certificate, CertificateProps, mkCertificate } from "../generated/certificatemanager.js";

// API Gateway
export {
  RestApi, RestApiProps, mkRestApi, getRestApiAtt,
  ApiGatewayResource, ApiGatewayResourceProps, mkApiGatewayResource as mkApiResource,
  Method, MethodProps, mkMethod as mkApiMethod,
  Deployment as ApiDeployment, DeploymentProps as ApiDeploymentProps, mkDeployment as mkApiDeployment,
  Stage as ApiStage, StageProps as ApiStageProps, mkStage as mkApiStage,
} from "../generated/apigateway.js";

// Route53
export { RecordSet, RecordSetProps, mkRecordSet } from "../generated/route53.js";
