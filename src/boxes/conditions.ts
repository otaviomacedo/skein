import type { Resource } from "../runtime/resource.js";
import type { Condition } from "../runtime/conditions.js";
import { setCondition } from "../runtime/registry.js";

export function when<T extends Resource>(resource: T, condition: Condition): T {
  setCondition(resource.logicalId, condition.name);
  return resource;
}
