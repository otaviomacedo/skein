import { Resource } from "../runtime/resource.js";
import { setMetadata } from "../runtime/registry.js";

export function addMetadata<T extends Resource>(resource: T, metadata: Record<string, unknown>): T {
  setMetadata(resource.logicalId, metadata);
  return resource;
}
