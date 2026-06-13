import { mintToken } from "./tokens.js";
import { registerResource } from "./registry.js";
import { assignStack } from "./stacks.js";
import { recordBoxCall } from "./graph.js";

export type Resource<T extends string = string> = {
  readonly __type: T;
  readonly logicalId: string;
  readonly properties: Record<string, unknown>;
};

export function ref(resource: Resource): string {
  return mintToken({ kind: "ref", logicalId: resource.logicalId });
}

export function getAtt(resource: Resource, attribute: string): string {
  return mintToken({ kind: "getAtt", logicalId: resource.logicalId, attribute });
}

export function fnJoin(delimiter: string, parts: unknown[]): string {
  return mintToken({ kind: "join", delimiter, parts });
}

export function fnSub(template: string): string {
  return mintToken({ kind: "sub", template });
}

export function fnSelect(index: number, list: unknown): string {
  return mintToken({ kind: "select", index, list });
}

export function deriveId(...parts: (Resource | string)[]): string {
  const full = parts.map((p) => (typeof p === "string" ? p : p.logicalId)).join("");
  if (full.length <= 64) return full;
  const hash = simpleHash(full);
  return full.slice(0, 56) + hash;
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 8).padStart(8, "0");
}

export type ResourceOptions = {
  stack?: string;
};

export function makeResource<T extends string>(
  type: T,
  logicalId: string,
  properties: object,
  options?: ResourceOptions,
): Resource<T> {
  const props = properties as Record<string, unknown>;
  const resource: Resource<T> = { __type: type, logicalId, properties: props };
  registerResource(logicalId, type, props);
  if (options?.stack) {
    assignStack(logicalId, options.stack);
  }
  recordBoxCall(`mk${type.split("::")[2]}`, [], [{ resourceId: logicalId, type }]);
  return resource;
}
