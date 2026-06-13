import { describe, it, expect, beforeEach } from "vitest";
import { resetTokens } from "../src/runtime/tokens";
import { resetRegistry } from "../src/runtime/registry";
import { resetParameters, mkParameter, paramRef } from "../src/runtime/parameters";
import { resetOutputs, output } from "../src/runtime/outputs";
import { resetConditions } from "../src/runtime/conditions";
import { resetMappings } from "../src/runtime/mappings";
import { synth } from "../src/runtime/synth";
import { mkBucket, getBucketAtt } from "../src/generated/s3";
import { mkRole } from "../src/generated/iam";
import { mkFunction } from "../src/lib/lambda";
import { mkDistribution, getDistributionAtt, mkCloudFrontOriginAccessIdentity as mkOAI } from "../src/generated/cloudfront";
import { mkCertificate } from "../src/generated/certificatemanager";
import { encrypt, enableVersioning, enableWebHosting, enableLogDelivery, blockPublicAccess } from "../src/boxes/s3";
import { grantWrite } from "../src/boxes/iam";
import { setOrigin, enableAccessLogging, attachCert, addAliasRecord } from "../src/boxes/cloudfront";
import { addEnvironment } from "../src/boxes/lambda";

function reset() {
  resetTokens();
  resetRegistry();
  resetParameters();
  resetOutputs();
  resetConditions();
  resetMappings();
}

describe("static site: full composition", () => {
  beforeEach(reset);

  it("produces a valid multi-resource template", () => {
    // Parameters
    const domainParam = mkParameter("DomainName", { type: "String", default: "example.com" });

    // Generators (top level, explicit IDs)
    const contentBucket = mkBucket("ContentBucket", {});
    const logBucket = mkBucket("LogBucket", {});
    const dist = mkDistribution("CDN", {
      distributionConfig: { defaultRootObject: "index.html", enabled: true },
    });
    const cert = mkCertificate("Cert", { domainName: paramRef(domainParam) });
    const oai = mkOAI("OAI", "Access identity for static site");
    const deployRole = mkRole("DeployRole", {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
      },
    });
    const deployFn = mkFunction("DeployFn", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: "deploy-code", s3Key: "deploy.zip" },
      role: deployRole,
    });

    // Transformers (sequential on content bucket)
    const cb2 = enableWebHosting(blockPublicAccess(encrypt(enableVersioning(contentBucket))));

    // Prepare log bucket
    const lb2 = enableLogDelivery(logBucket);

    // Wire CloudFront
    const [dist2, , ] = setOrigin(dist, cb2, oai);
    const [dist3, ] = enableAccessLogging(dist2, lb2);
    const [dist4, ] = attachCert(dist3, cert);
    const [dist5, aliasRecord] = addAliasRecord(dist4, { hostedZone: "example.com" });

    // Grant deploy function write access
    const [deployFn2, , writePolicy] = grantWrite(deployFn, cb2);

    // Add bucket name to function environment
    const deployFn3 = addEnvironment(deployFn2, "BUCKET_NAME", getBucketAtt(cb2, "DomainName"));

    // Outputs
    output("DistributionDomain", getDistributionAtt(dist5, "DomainName"));
    output("ContentBucketArn", getBucketAtt(cb2, "Arn"));

    // Synth
    const template = synth();

    // --- Assertions ---

    // Parameters section
    expect(template.Parameters).toBeDefined();
    expect(template.Parameters!["DomainName"]).toEqual({
      Type: "String",
      Default: "example.com",
    });

    // Correct resource count: 2 buckets + distribution + cert + OAI + role + function + policy + record = 9
    expect(Object.keys(template.Resources)).toHaveLength(9);

    // Content bucket has all transformations merged
    const cbProps = template.Resources.ContentBucket.Properties as Record<string, unknown>;
    expect(cbProps.versioningConfiguration).toEqual({ status: "Enabled" });
    expect(cbProps.bucketEncryption).toBeDefined();
    expect(cbProps.publicAccessBlockConfiguration).toBeDefined();
    expect(cbProps.websiteConfiguration).toEqual({ indexDocument: "index.html", errorDocument: "error.html" });

    // Log bucket has ownership controls
    const lbProps = template.Resources.LogBucket.Properties as Record<string, unknown>;
    expect(lbProps.ownershipControls).toBeDefined();

    // Distribution config has origin, logging, cert
    const distProps = template.Resources.CDN.Properties as Record<string, unknown>;
    const distConfig = distProps.distributionConfig as Record<string, unknown>;
    expect(distConfig.origins).toBeDefined();
    expect(distConfig.logging).toBeDefined();
    expect(distConfig.viewerCertificate).toBeDefined();

    // Function has environment variable with bucket reference
    const fnProps = template.Resources.DeployFn.Properties as Record<string, unknown>;
    const env = (fnProps.environment as Record<string, unknown>).variables as Record<string, unknown>;
    expect(env.BUCKET_NAME).toEqual({ "Fn::GetAtt": ["ContentBucket", "DomainName"] });

    // Function references role
    expect(fnProps.role).toEqual({ "Fn::GetAtt": ["DeployRole", "Arn"] });

    // Alias record exists with derived ID
    expect(template.Resources["CDNAliasRecord"]).toBeDefined();
    expect(template.Resources["CDNAliasRecord"].Type).toBe("AWS::Route53::RecordSet");

    // Outputs section
    expect(template.Outputs).toBeDefined();
    expect(template.Outputs!["DistributionDomain"]).toMatchObject({
      Value: { "Fn::GetAtt": ["CDN", "DomainName"] },
    });
    expect(template.Outputs!["ContentBucketArn"]).toMatchObject({
      Value: { "Fn::GetAtt": ["ContentBucket", "Arn"] },
    });

    // DependsOn relationships
    expect(template.Resources.DeployFn.DependsOn).toContain("DeployRole");
    expect(template.Resources.CDN.DependsOn).toContain("ContentBucket");
    expect(template.Resources.CDN.DependsOn).toContain("LogBucket");
  });
});
