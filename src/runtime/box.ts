import { Resource } from "./resource.js";
import { recordBoxCall, pushBoxContext, popBoxContext, updateBoxOutputs, WireRef } from "./graph.js";

function toWireRef(resource: Resource): WireRef {
  return { resourceId: resource.logicalId, type: resource.__type };
}

export function box<TIn extends unknown[], TOut>(
  name: string,
  fn: (...args: TIn) => TOut,
): (...args: TIn) => TOut {
  return (...args: TIn): TOut => {
    const inputs: WireRef[] = [];
    for (const arg of args) {
      if (isResource(arg)) inputs.push(toWireRef(arg));
    }

    const callId = recordBoxCall(name, inputs, []);
    pushBoxContext(callId);

    const result = fn(...args);

    popBoxContext();

    const outputs: WireRef[] = [];
    if (isResource(result)) {
      outputs.push(toWireRef(result));
    } else if (Array.isArray(result)) {
      for (const item of result) {
        if (isResource(item)) outputs.push(toWireRef(item));
      }
    }
    updateBoxOutputs(callId, outputs);

    return result;
  };
}

function isResource(value: unknown): value is Resource {
  return (
    value !== null &&
    typeof value === "object" &&
    "__type" in (value as object) &&
    "logicalId" in (value as object)
  );
}
