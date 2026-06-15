import { describe, it, expect } from "vitest";
import { synthTest, hasResource, resourceOfType } from "../src/testing/index.js";
import { mkLambda } from "../src/boxes/lambda-helpers.js";
import { stepFunctionsPipeline, buildDefinition } from "../src/boxes/step-functions.js";

describe("stepFunctionsPipeline", () => {
  it("creates a state machine with sequential Lambda steps", () => {
    const template = synthTest(() => {
      const validate = mkLambda("Validate", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "validate.zip" },
      });

      const transform = mkLambda("Transform", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "transform.zip" },
      });

      const load = mkLambda("Load", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "load.zip" },
      });

      stepFunctionsPipeline("ETL", {
        steps: [
          { name: "Validate", fn: validate },
          { name: "Transform", fn: transform },
          { name: "Load", fn: load },
        ],
      });
    });

    expect(hasResource(template, "ETL", { type: "AWS::StepFunctions::StateMachine" })).toBe(true);
    expect(hasResource(template, "ETLRole", { type: "AWS::IAM::Role" })).toBe(true);
    expect(hasResource(template, "ETLInvokePolicy", { type: "AWS::IAM::Policy" })).toBe(true);
  });

  it("supports choice states for branching", () => {
    const template = synthTest(() => {
      const processSmall = mkLambda("ProcessSmall", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "small.zip" },
      });

      const processLarge = mkLambda("ProcessLarge", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "large.zip" },
      });

      const classify = mkLambda("Classify", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "classify.zip" },
      });

      stepFunctionsPipeline("Router", {
        steps: [
          { name: "Classify", fn: classify },
          {
            name: "RouteBySize",
            choices: [
              { variable: "$.size", comparison: "NumericGreaterThan", value: 1000, next: "ProcessLarge" },
            ],
            default: "ProcessSmall",
          },
          { name: "ProcessSmall", fn: processSmall },
          { name: "ProcessLarge", fn: processLarge },
        ],
      });
    });

    expect(hasResource(template, "Router", { type: "AWS::StepFunctions::StateMachine" })).toBe(true);
  });

  it("collects lambdas from parallel and map branches for IAM policy", () => {
    const template = synthTest(() => {
      const fnA = mkLambda("FnA", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "a.zip" },
      });

      const fnB = mkLambda("FnB", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "b.zip" },
      });

      const fnC = mkLambda("FnC", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "c.zip" },
      });

      stepFunctionsPipeline("Complex", {
        steps: [
          {
            name: "Parallel",
            branches: [
              [{ name: "A", fn: fnA }],
              [{ name: "B", fn: fnB }],
            ],
          },
          {
            name: "MapOver",
            itemsPath: "$.items",
            iterator: [{ name: "C", fn: fnC }],
          },
        ],
      });
    });

    // All 3 Lambda functions should be in the IAM policy
    expect(hasResource(template, "ComplexInvokePolicy", { type: "AWS::IAM::Policy" })).toBe(true);
  });

  it("returns typed outputs", () => {
    synthTest(() => {
      const fn = mkLambda("Step", {
        runtime: "nodejs20.x",
        handler: "index.handler",
        code: { s3Bucket: "code", s3Key: "step.zip" },
      });

      const result = stepFunctionsPipeline("Workflow", {
        steps: [{ name: "DoWork", fn }],
      });

      expect(result.stateMachine.logicalId).toBe("Workflow");
      expect(result.role.logicalId).toBe("WorkflowRole");
    });
  });
});

describe("buildDefinition", () => {
  it("produces valid ASL for a sequential chain", () => {
    const fakeFn = { arn: "arn:aws:lambda:us-east-1:123:function:test" } as any;

    const asl = buildDefinition([
      { name: "Step1", fn: fakeFn },
      { name: "Step2", fn: fakeFn },
      { name: "Step3", fn: fakeFn },
    ]);

    expect(asl.StartAt).toBe("Step1");
    const states = asl.States as Record<string, any>;
    expect(states.Step1.Next).toBe("Step2");
    expect(states.Step2.Next).toBe("Step3");
    expect(states.Step3.End).toBe(true);
    expect(states.Step3.Next).toBeUndefined();
  });

  it("produces valid ASL for choice states", () => {
    const fakeFn = { arn: "arn:aws:lambda:us-east-1:123:function:test" } as any;

    const asl = buildDefinition([
      { name: "Start", fn: fakeFn },
      {
        name: "Branch",
        choices: [{ variable: "$.status", comparison: "StringEquals", value: "ok", next: "Done" }],
        default: "Retry",
      },
      { name: "Retry", fn: fakeFn },
      { name: "Done", fn: fakeFn },
    ]);

    const states = asl.States as Record<string, any>;
    expect(states.Branch.Type).toBe("Choice");
    expect(states.Branch.Choices[0].Next).toBe("Done");
    expect(states.Branch.Default).toBe("Retry");
  });

  it("produces valid ASL for parallel states", () => {
    const fakeFn = { arn: "arn:aws:lambda:us-east-1:123:function:a" } as any;
    const fakeFn2 = { arn: "arn:aws:lambda:us-east-1:123:function:b" } as any;

    const asl = buildDefinition([
      { name: "Init", fn: fakeFn },
      {
        name: "FanOut",
        branches: [
          [{ name: "BranchA", fn: fakeFn }],
          [{ name: "BranchB", fn: fakeFn2 }],
        ],
        resultPath: "$.parallel",
      },
      { name: "Merge", fn: fakeFn },
    ]);

    const states = asl.States as Record<string, any>;
    expect(states.FanOut.Type).toBe("Parallel");
    expect(states.FanOut.Branches.length).toBe(2);
    expect(states.FanOut.Branches[0].StartAt).toBe("BranchA");
    expect(states.FanOut.Branches[1].StartAt).toBe("BranchB");
    expect(states.FanOut.ResultPath).toBe("$.parallel");
    expect(states.FanOut.Next).toBe("Merge");
  });

  it("produces valid ASL for map states", () => {
    const fakeFn = { arn: "arn:aws:lambda:us-east-1:123:function:proc" } as any;

    const asl = buildDefinition([
      {
        name: "ProcessItems",
        itemsPath: "$.items",
        iterator: [{ name: "ProcessOne", fn: fakeFn }],
        maxConcurrency: 10,
        resultPath: "$.results",
      },
      { name: "Done", succeed: true as const },
    ]);

    const states = asl.States as Record<string, any>;
    expect(states.ProcessItems.Type).toBe("Map");
    expect(states.ProcessItems.ItemsPath).toBe("$.items");
    expect(states.ProcessItems.ItemProcessor.StartAt).toBe("ProcessOne");
    expect(states.ProcessItems.MaxConcurrency).toBe(10);
    expect(states.ProcessItems.ResultPath).toBe("$.results");
    expect(states.ProcessItems.Next).toBe("Done");
  });

  it("produces valid ASL for wait states", () => {
    const fakeFn = { arn: "arn:aws:lambda:us-east-1:123:function:x" } as any;

    const asl = buildDefinition([
      { name: "Pause", seconds: 30 },
      { name: "Continue", fn: fakeFn },
    ]);

    const states = asl.States as Record<string, any>;
    expect(states.Pause.Type).toBe("Wait");
    expect(states.Pause.Seconds).toBe(30);
    expect(states.Pause.Next).toBe("Continue");
  });

  it("produces valid ASL for pass, succeed, and fail states", () => {
    const asl = buildDefinition([
      { name: "Inject", result: { key: "value" }, resultPath: "$.injected" },
      { name: "CheckOk", choices: [{ variable: "$.ok", comparison: "BooleanEquals", value: true, next: "AllGood" }], default: "NotGood" },
      { name: "AllGood", succeed: true as const },
      { name: "NotGood", error: "ValidationFailed", cause: "Input was invalid" },
    ]);

    const states = asl.States as Record<string, any>;
    expect(states.Inject.Type).toBe("Pass");
    expect(states.Inject.Result).toEqual({ key: "value" });
    expect(states.Inject.ResultPath).toBe("$.injected");
    expect(states.AllGood.Type).toBe("Succeed");
    expect(states.NotGood.Type).toBe("Fail");
    expect(states.NotGood.Error).toBe("ValidationFailed");
    expect(states.NotGood.Cause).toBe("Input was invalid");
  });
});