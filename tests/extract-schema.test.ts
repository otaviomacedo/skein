import { describe, it, expect } from "vitest";
import { extractSchemas } from "../src/compat/extract-schema.js";
import { checkCompatAuto, checkCompatFromSource } from "../src/compat/index.js";
import { resolve } from "path";
import { scheduledProcessor } from "../src/boxes/scheduled-processor.js";

describe("extractSchemas", () => {
  it("extracts schema from scheduled-processor box", () => {
    const filePath = resolve("src/boxes/scheduled-processor.ts");
    const schemas = extractSchemas(filePath);

    expect(schemas.length).toBe(1);
    expect(schemas[0].boxName).toBe("scheduledProcessor");

    const inputs = schemas[0].schema.inputs;
    // scheduledProcessor(logicalId: string, props: ScheduledProcessorProps)
    expect(inputs.length).toBe(2);
    expect(inputs[0].kind).toBe("string");
    // props is an object with schedule (string), table (Resource), failureQueue (Resource), functionProps (object)
    expect(inputs[1].kind).toBe("props");
  });

  it("extracts schema from sns-fanout box", () => {
    const filePath = resolve("src/boxes/sns-fanout.ts");
    const schemas = extractSchemas(filePath);

    expect(schemas.length).toBe(1);
    expect(schemas[0].boxName).toBe("snsFanout");

    const inputs = schemas[0].schema.inputs;
    // snsFanout(topic: Topic, handlers: LambdaFunction[])
    expect(inputs.length).toBe(2);
    expect(inputs[0]).toEqual({ kind: "resource", type: "AWS::SNS::Topic" });
    // handlers is an array of LambdaFunction — extracted as a resource type
    expect(inputs[1].kind).toBe("resource");
    if (inputs[1].kind === "resource") {
      expect(inputs[1].type).toBe("AWS::Lambda::Function");
    }
  });

  it("extracts schema from queue-processor box", () => {
    const filePath = resolve("src/boxes/queue-processor.ts");
    const schemas = extractSchemas(filePath);

    expect(schemas.length).toBe(1);
    expect(schemas[0].boxName).toBe("queueProcessor");

    const inputs = schemas[0].schema.inputs;
    // queueProcessor(logicalId: string, props: QueueProcessorProps)
    expect(inputs.length).toBe(2);
    expect(inputs[0].kind).toBe("string");
    expect(inputs[1].kind).toBe("props");
  });

  it("end-to-end: extract schema + compat check (no manual authoring)", () => {
    const filePath = resolve("src/boxes/scheduled-processor.ts");
    const schemas = extractSchemas(filePath);
    const schema = schemas[0].schema;

    const result = checkCompatAuto(scheduledProcessor, scheduledProcessor, schema);
    expect(result.level).toBe("strict");
  });

  it("fully automated: checkCompatFromSource (single function call)", () => {
    const filePath = resolve("src/boxes/scheduled-processor.ts");

    const result = checkCompatFromSource(filePath, scheduledProcessor, scheduledProcessor);
    expect(result.level).toBe("strict");
  });
});
