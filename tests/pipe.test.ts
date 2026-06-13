import { describe, it, expect, beforeEach } from "vitest";
import { resetAll, synthTest } from "../src/testing/index";
import { mkBucket, getBucketAtt } from "../src/generated/s3";
import { mkRole } from "../src/generated/iam";
import { mkFunction } from "../src/lib/lambda";
import { mkDistribution, mkCloudFrontOriginAccessIdentity as mkOAI } from "../src/generated/cloudfront";
import { mkCertificate } from "../src/generated/certificatemanager";
import { encrypt, enableVersioning, enableWebHosting, blockPublicAccess } from "../src/boxes/s3";
import { grantRead } from "../src/boxes/iam";
import { addEnvironment } from "../src/boxes/lambda";
import { setOrigin, enableAccessLogging, attachCert } from "../src/boxes/cloudfront";
import { pipe } from "../src/boxes/pipe";
import { ref } from "../src/runtime/resource";

describe("pipe", () => {
  beforeEach(() => resetAll());

  it("chains simple transformers", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("B", {});
      pipe(bucket)
        .to(enableVersioning)
        .to(encrypt)
        .to(enableWebHosting)
        .to(blockPublicAccess)
        .done();
    });

    const props = template.Resources.B.Properties as Record<string, unknown>;
    expect(props.versioningConfiguration).toEqual({ status: "Enabled" });
    expect(props.bucketEncryption).toBeDefined();
    expect(props.websiteConfiguration).toBeDefined();
    expect(props.publicAccessBlockConfiguration).toBeDefined();
  });

  it("chains multi-output boxes (threads first element)", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("Content", {});
      const logBucket = mkBucket("Logs", {});
      const oai = mkOAI("OAI", { cloudFrontOriginAccessIdentityConfig: { comment: "" } });
      const cert = mkCertificate("Cert", { domainName: "example.com" });
      const dist = mkDistribution("CDN", {
        distributionConfig: { defaultRootObject: "index.html", enabled: true },
      });

      pipe(dist)
        .to(setOrigin, bucket, oai)
        .to(enableAccessLogging, logBucket)
        .to(attachCert, cert)
        .done();
    });

    const distProps = template.Resources.CDN.Properties as Record<string, unknown>;
    const config = distProps.distributionConfig as Record<string, unknown>;
    expect(config.origins).toBeDefined();
    expect(config.logging).toBeDefined();
    expect(config.viewerCertificate).toBeDefined();
  });

  it("chains environment variable additions", () => {
    const template = synthTest(() => {
      const role = mkRole("R", { assumeRolePolicyDocument: {} });
      const bucket = mkBucket("B", {});
      const fn = mkFunction("Fn", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "fn.zip" },
        role,
      });

      pipe(fn)
        .to(addEnvironment, "KEY1", "value1")
        .to(addEnvironment, "KEY2", "value2")
        .to(addEnvironment, "BUCKET", ref(bucket))
        .done();
    });

    const fnProps = template.Resources.Fn.Properties as Record<string, unknown>;
    const env = (fnProps.environment as Record<string, unknown>).variables as Record<string, unknown>;
    expect(env.KEY1).toBe("value1");
    expect(env.KEY2).toBe("value2");
    expect(env.BUCKET).toEqual({ Ref: "B" });
  });

  it("done() returns the final value", () => {
    const bucket = mkBucket("B", {});
    const result = pipe(bucket)
      .to(enableVersioning)
      .to(encrypt)
      .done();

    expect(result.logicalId).toBe("B");
    expect(result.properties.versioningConfiguration).toEqual({ status: "Enabled" });
    expect(result.properties.bucketEncryption).toBeDefined();
  });

  it("mixes transformers and multi-output grant boxes", () => {
    const template = synthTest(() => {
      const bucket = mkBucket("B", {});
      const role = mkRole("R", { assumeRolePolicyDocument: {} });
      const fn = mkFunction("Fn", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "fn.zip" },
        role,
      });

      pipe(fn)
        .to(grantRead, bucket)
        .to(addEnvironment, "BUCKET", ref(bucket))
        .done();
    });

    expect(template.Resources["RBReadPolicy"]).toBeDefined();
    const fnProps = template.Resources.Fn.Properties as Record<string, unknown>;
    const env = (fnProps.environment as Record<string, unknown>).variables as Record<string, unknown>;
    expect(env.BUCKET).toEqual({ Ref: "B" });
  });
});
