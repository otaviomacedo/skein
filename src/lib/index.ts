// User-facing re-exports with friendly names and typed references

// S3
export { mkBucket, getBucketAtt } from "../generated/s3.js";
export type { Bucket, BucketProps } from "../generated/s3.js";

// IAM
export { mkRole, getRoleAtt, mkPolicy } from "../generated/iam.js";
export type { Role, RoleProps, Policy, PolicyProps } from "../generated/iam.js";

// Lambda (with typed role reference)
export { mkFunction } from "./lambda.js";
export type { Function, FunctionProps } from "./lambda.js";
export { mkEventSourceMapping } from "../generated/lambda.js";
export type { EventSourceMapping, Permission } from "../generated/lambda.js";
export { mkPermission } from "../generated/lambda.js";

// DynamoDB
export { mkTable, getTableAtt } from "../generated/dynamodb.js";
export type { Table, TableProps } from "../generated/dynamodb.js";

// SQS
export { mkQueue, getQueueAtt } from "../generated/sqs.js";
export type { Queue, QueueProps } from "../generated/sqs.js";

// CloudFront
export { mkDistribution, getDistributionAtt } from "../generated/cloudfront.js";
export type { Distribution, DistributionProps } from "../generated/cloudfront.js";
export { mkCloudFrontOriginAccessIdentity as mkOAI } from "../generated/cloudfront.js";
export type {
  CloudFrontOriginAccessIdentity as OAI,
  CloudFrontOriginAccessIdentityProps as OAIProps,
} from "../generated/cloudfront.js";

// ACM
export { mkCertificate } from "../generated/certificatemanager.js";
export type { Certificate, CertificateProps } from "../generated/certificatemanager.js";

// API Gateway
export { mkRestApi, getRestApiAtt, mkApiGatewayResource as mkApiResource, mkMethod as mkApiMethod, mkDeployment as mkApiDeployment, mkStage as mkApiStage } from "../generated/apigateway.js";
export type {
  RestApi, RestApiProps,
  ApiGatewayResource, ApiGatewayResourceProps,
  Method, MethodProps,
  Deployment as ApiDeployment, DeploymentProps as ApiDeploymentProps,
  Stage as ApiStage, StageProps as ApiStageProps,
} from "../generated/apigateway.js";

// Route53
export { mkRecordSet } from "../generated/route53.js";
export type { RecordSet, RecordSetProps } from "../generated/route53.js";
