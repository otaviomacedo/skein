import type { Patch } from "./registry.js";
import { ConflictError } from "./errors.js";

export { ConflictError };

export type MergedResource = {
  logicalId: string;
  type: string;
  properties: Record<string, unknown>;
};

const mergeableCollections = new Set<string>([
  "Tags",
  "PolicyDocument.Statement",
  "Statements",
  "SecurityGroupIngress",
  "SecurityGroupEgress",
  "Rules",
  "Targets",
  "targets",
]);

export function addMergeableCollection(path: string): void {
  mergeableCollections.add(path);
}

export function mergePatchesByLogicalId(patches: Patch[]): MergedResource[] {
  const groups = new Map<string, Patch[]>();

  for (const p of patches) {
    if (!groups.has(p.logicalId)) groups.set(p.logicalId, []);
    groups.get(p.logicalId)!.push(p);
  }

  return Array.from(groups.entries()).map(([logicalId, group]) => {
    const type = group[0].type;
    const properties = deepMergeAll(
      group.map((p) => p.properties),
      logicalId,
    );
    return { logicalId, type, properties };
  });
}

function deepMergeAll(
  propsList: Record<string, unknown>[],
  logicalId: string,
): Record<string, unknown> {
  let result: Record<string, unknown> = {};

  for (const props of propsList) {
    result = deepMergeObjects(result, props, logicalId);
  }

  return result;
}

function deepMergeObjects(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in result)) {
      result[key] = value;
    } else {
      result[key] = deepMerge(result[key], value, `${path}.${key}`);
    }
  }

  return result;
}

function deepMerge(existing: unknown, incoming: unknown, path: string): unknown {
  if (existing === incoming) return existing;
  if (deepEqual(existing, incoming)) return existing;

  if (isPlainObject(existing) && isPlainObject(incoming)) {
    return deepMergeObjects(
      existing as Record<string, unknown>,
      incoming as Record<string, unknown>,
      path,
    );
  }

  if (Array.isArray(existing) && Array.isArray(incoming)) {
    const leafPath = path.split(".").slice(-1)[0];
    const fullLeafPath = path.split(".").slice(-2).join(".");
    if (mergeableCollections.has(leafPath) || mergeableCollections.has(fullLeafPath)) {
      return [...existing, ...incoming];
    }
    throw new ConflictError(
      path, existing, incoming,
      "If both values should coexist, sequence the modifications or mark this array as a mergeable collection.",
    );
  }

  throw new ConflictError(
    path, existing, incoming,
    "Sequence these modifications so one builds on the other's output.",
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  return false;
}
