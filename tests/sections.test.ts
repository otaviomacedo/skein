import { describe, it, expect, beforeEach } from "vitest";
import { resetTokens } from "../src/runtime/tokens";
import { resetRegistry } from "../src/runtime/registry";
import { resetConditions, mkCondition, fnEquals, fnAnd, fnNot, fnIf } from "../src/runtime/conditions";
import { resetMappings, mkMapping, findInMap } from "../src/runtime/mappings";
import { resetParameters, mkParameter, paramRef, pseudoParam } from "../src/runtime/parameters";
import { resetOutputs, output } from "../src/runtime/outputs";
import { synth } from "../src/runtime/synth";
import { mkBucket, getBucketAtt } from "../src/generated/s3";
import { when } from "../src/boxes/conditions";

function reset() {
  resetTokens();
  resetRegistry();
  resetConditions();
  resetMappings();
  resetParameters();
  resetOutputs();
}

describe("conditions", () => {
  beforeEach(reset);

  it("emits a Conditions section", () => {
    const env = mkParameter("Environment", { type: "String" });
    const isProd = mkCondition("IsProd", fnEquals(paramRef(env), "prod"));
    mkBucket("Bucket", {});

    const template = synth();
    expect(template.Conditions).toEqual({
      IsProd: { "Fn::Equals": [{ Ref: "Environment" }, "prod"] },
    });
  });

  it("attaches a condition to a resource via when()", () => {
    const isProd = mkCondition("IsProd", fnEquals("a", "b"));
    const bucket = mkBucket("ProdBucket", {});
    when(bucket, isProd);

    const template = synth();
    expect(template.Resources.ProdBucket.Condition).toBe("IsProd");
  });

  it("resolves fnIf in property values", () => {
    const isProd = mkCondition("IsProd", fnEquals("a", "b"));
    const logLevel = fnIf(isProd, "ERROR", "DEBUG");
    mkBucket("Bucket", { bucketName: logLevel as unknown as string });

    const template = synth();
    const props = template.Resources.Bucket.Properties as Record<string, unknown>;
    expect(props.bucketName).toEqual({ "Fn::If": ["IsProd", "ERROR", "DEBUG"] });
  });

  it("supports condition combinators", () => {
    const isProd = mkCondition("IsProd", fnEquals("a", "prod"));
    const isUs = mkCondition("IsUs", fnEquals("b", "us-east-1"));
    mkCondition("IsProdUs", fnAnd(isProd, isUs));
    mkCondition("IsNotProd", fnNot(isProd));
    mkBucket("Bucket", {});

    const template = synth();
    expect(template.Conditions!["IsProdUs"]).toEqual({
      "Fn::And": [{ Condition: "IsProd" }, { Condition: "IsUs" }],
    });
    expect(template.Conditions!["IsNotProd"]).toEqual({
      "Fn::Not": [{ Condition: "IsProd" }],
    });
  });
});

describe("mappings", () => {
  beforeEach(reset);

  it("emits a Mappings section", () => {
    mkMapping("RegionAMI", {
      "us-east-1": { HVM64: "ami-123" },
      "eu-west-1": { HVM64: "ami-456" },
    });
    mkBucket("Bucket", {});

    const template = synth();
    expect(template.Mappings).toEqual({
      RegionAMI: {
        "us-east-1": { HVM64: "ami-123" },
        "eu-west-1": { HVM64: "ami-456" },
      },
    });
  });

  it("resolves findInMap to Fn::FindInMap", () => {
    const regionMap = mkMapping("RegionAMI", {
      "us-east-1": { HVM64: "ami-123" },
    });
    const region = pseudoParam("AWS::Region");
    const ami = findInMap(regionMap, region, "HVM64");
    mkBucket("Bucket", { bucketName: ami as unknown as string });

    const template = synth();
    const props = template.Resources.Bucket.Properties as Record<string, unknown>;
    expect(props.bucketName).toEqual({
      "Fn::FindInMap": ["RegionAMI", { Ref: "AWS::Region" }, "HVM64"],
    });
  });
});

describe("parameters", () => {
  beforeEach(reset);

  it("emits a Parameters section", () => {
    mkParameter("Environment", {
      type: "String",
      allowedValues: ["prod", "staging", "dev"],
      default: "dev",
      description: "Deployment environment",
    });
    mkBucket("Bucket", {});

    const template = synth();
    expect(template.Parameters).toEqual({
      Environment: {
        Type: "String",
        AllowedValues: ["prod", "staging", "dev"],
        Default: "dev",
        Description: "Deployment environment",
      },
    });
  });

  it("paramRef resolves to Ref", () => {
    const env = mkParameter("Env", { type: "String" });
    mkBucket("Bucket", { bucketName: paramRef(env) });

    const template = synth();
    const props = template.Resources.Bucket.Properties as Record<string, unknown>;
    expect(props.bucketName).toEqual({ Ref: "Env" });
  });

  it("pseudoParam resolves to Ref with pseudo-parameter name", () => {
    const region = pseudoParam("AWS::Region");
    mkBucket("Bucket", { bucketName: region });

    const template = synth();
    const props = template.Resources.Bucket.Properties as Record<string, unknown>;
    expect(props.bucketName).toEqual({ Ref: "AWS::Region" });
  });
});

describe("outputs", () => {
  beforeEach(reset);

  it("emits an Outputs section", () => {
    const bucket = mkBucket("Bucket", {});
    output("BucketArn", getBucketAtt(bucket, "Arn"), {
      description: "The bucket ARN",
    });

    const template = synth();
    expect(template.Outputs).toEqual({
      BucketArn: {
        Value: { "Fn::GetAtt": ["Bucket", "Arn"] },
        Description: "The bucket ARN",
      },
    });
  });

  it("supports export names", () => {
    const bucket = mkBucket("Bucket", {});
    output("BucketArn", getBucketAtt(bucket, "Arn"), {
      exportName: "SharedBucketArn",
    });

    const template = synth();
    expect(template.Outputs!["BucketArn"]).toMatchObject({
      Export: { Name: "SharedBucketArn" },
    });
  });
});
