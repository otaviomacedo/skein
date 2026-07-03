import type { Resource } from "../runtime/resource.js";
import type { Condition } from "../runtime/conditions";
import { setCondition } from "../runtime/registry";

export function when<T extends Resource>(resource: T, condition: Condition): T {
  setCondition(resource.logicalId, condition.name);
  return resource;
}
