import { Resource } from "./resource.js";
import { recordBoxCall, pushBoxContext, popBoxContext, updateBoxOutputs, WireRef, getKnownResourceType } from "./graph.js";
import { extractAllLogicalIds, isToken } from "./tokens.js";

function toWireRef(resource: Resource): WireRef {
  return { resourceId: resource.logicalId, type: resource.__type };
}

export function box<TIn extends unknown[], TOut>(
  name: string,
  fn: (...args: TIn) => TOut,
): (...args: TIn) => TOut {
  return (...args: TIn): TOut => {
    const inputs: WireRef[] = [];
    const seen = new Set<string>();
    for (const arg of args) {
      collectResources(arg, inputs, seen);
    }

    const callId = recordBoxCall(name, inputs, []);
    pushBoxContext(callId);

    const result = fn(...args);

    popBoxContext();

    const outputs: WireRef[] = [];
    const outputSeen = new Set<string>();
    collectResources(result, outputs, outputSeen);
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

function collectResources(value: unknown, out: WireRef[], seen: Set<string>): void {
  if (value === null || value === undefined) return;
  if (isResource(value)) {
    if (!seen.has(value.logicalId)) {
      seen.add(value.logicalId);
      out.push(toWireRef(value));
    }
    return;
  }
  if (typeof value === "string") {
    if (isToken(value)) {
      for (const logicalId of extractAllLogicalIds(value)) {
        if (!seen.has(logicalId)) {
          const type = getKnownResourceType(logicalId);
          if (type) {
            seen.add(logicalId);
            out.push({ resourceId: logicalId, type });
          }
        }
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectResources(item, out, seen);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectResources(v, out, seen);
    }
  }
}
