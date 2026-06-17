import { resetAll } from "../testing/index.js";
import { synth, Template } from "../runtime/synth.js";
import { makeResource } from "../runtime/resource.js";
import { Resource } from "../runtime/resource.js";
import { fixtures } from "../generated/fixtures.js";
import { extractSchemas } from "./extract-schema.js";

// === Compatibility levels and result types ===

export type CompatLevel = "strict" | "patch" | "breaking";

export type PropertyDiff = {
  path: string;
  kind: "removed" | "changed" | "type-changed";
  oldValue?: unknown;
  newValue?: unknown;
};

export type ResourceDiff = {
  logicalId: string;
} & (
  | { kind: "removed" }
  | { kind: "type-changed"; oldType: string; newType: string }
  | { kind: "property-diff"; diffs: PropertyDiff[] }
);

export type CompatResult = {
  level: CompatLevel;
  diffs: ResourceDiff[];
  oldResourceCount: number;
  newResourceCount: number;
  addedResources: string[];
  removedResources: string[];
};

// === Input schema declaration ===

export type InputKind =
  | { kind: "string"; value?: string }
  | { kind: "number"; value?: number }
  | { kind: "resource"; type: string; props?: Record<string, unknown>; factory?: (id: string, props: any) => any }
  | { kind: "props"; value: Record<string, unknown> };

/**
 * Shorthand for declaring a resource input using just the CloudFormation type.
 * Props and factory are looked up from the generated fixtures registry.
 */
export function resource(type: string, propsOverride?: Record<string, unknown>): InputKind {
  return { kind: "resource", type, props: propsOverride };
}

export type BoxSchema = {
  inputs: InputKind[];
};

/**
 * Declares the input schema for a box, enabling automatic fixture generation
 * for compatibility checking.
 *
 * Example:
 *   const schema = declareSchema({
 *     inputs: [
 *       { kind: "string", value: "Worker" },
 *       { kind: "props", value: { runtime: "nodejs20.x", handler: "index.handler", code: { s3Bucket: "b", s3Key: "k" } } },
 *       { kind: "resource", type: "AWS::DynamoDB::Table", props: { keySchema: [{ attributeName: "pk", keyType: "HASH" }] } },
 *       { kind: "resource", type: "AWS::SQS::Queue" },
 *     ],
 *   });
 */
export function declareSchema(schema: BoxSchema): BoxSchema {
  return schema;
}

// === Fixture generation ===

let fixtureCounter = 0;

function generateFixtures(schema: BoxSchema): unknown[] {
  return schema.inputs.map((input, i) => {
    switch (input.kind) {
      case "string":
        return input.value ?? `Fixture${i}`;
      case "number":
        return input.value ?? i;
      case "resource":
        return generateResource(input.type, input.props ?? {}, input.factory);
      case "props":
        return input.value;
    }
  });
}

function generateResource(type: string, props?: Record<string, unknown>, factory?: (id: string, props: any) => any): Resource {
  const id = `Fixture${type.split("::")[2] ?? "Resource"}${fixtureCounter++}`;

  if (factory) {
    return factory(id, props ?? {});
  }

  const entry = fixtures[type];
  if (entry) {
    const mergedProps = { ...entry.minimalProps, ...props };
    return entry.factory(id, mergedProps);
  }

  return makeResource(type, id, props ?? {});
}

function resetFixtures(): void {
  fixtureCounter = 0;
}

// === Core compat check (with manual setup) ===

/**
 * Checks backwards compatibility between two versions of a box by comparing
 * their synth outputs for a given setup function.
 *
 * The `setup` function receives the box as argument and should call it with
 * representative inputs (creating any prerequisite resources first). It is
 * called twice: once with `oldBox` and once with `newBox`.
 */
export function checkCompat<TBox>(
  oldBox: TBox,
  newBox: TBox,
  setup: (boxFn: TBox) => void,
): CompatResult {
  const oldTemplate = synthInIsolation(() => setup(oldBox));
  const newTemplate = synthInIsolation(() => setup(newBox));
  return compareTemplates(oldTemplate, newTemplate);
}

/**
 * Checks compatibility across multiple representative inputs.
 * Returns the worst (least compatible) result.
 */
export function checkCompatMulti<TBox>(
  oldBox: TBox,
  newBox: TBox,
  setups: Array<{ name: string; setup: (boxFn: TBox) => void }>,
): { results: Array<{ name: string; result: CompatResult }>; worst: CompatLevel } {
  const results: Array<{ name: string; result: CompatResult }> = [];
  let worst: CompatLevel = "strict";

  for (const { name, setup } of setups) {
    const result = checkCompat(oldBox, newBox, setup);
    results.push({ name, result });
    if (levelOrdinal(result.level) > levelOrdinal(worst)) {
      worst = result.level;
    }
  }

  return { results, worst };
}

// === Schema-driven compat check (automatic fixtures) ===

/**
 * Checks backwards compatibility using a declared schema to generate inputs
 * automatically. No hand-written setup function needed.
 *
 * Example:
 *   const result = checkCompatAuto(workerBoxV1, workerBoxV2, schema);
 */
export function checkCompatAuto(
  oldBox: (...args: any[]) => any,
  newBox: (...args: any[]) => any,
  schema: BoxSchema,
): CompatResult {
  const oldTemplate = synthInIsolation(() => {
    resetFixtures();
    const inputs = generateFixtures(schema);
    oldBox(...inputs);
  });

  const newTemplate = synthInIsolation(() => {
    resetFixtures();
    const inputs = generateFixtures(schema);
    newBox(...inputs);
  });

  return compareTemplates(oldTemplate, newTemplate);
}

// === Fully automated compat check ===

/**
 * Fully automated backwards compatibility check. Given a source file path
 * and two box functions, extracts the schema from the source, generates
 * fixtures, synths both versions, and compares.
 *
 * This is the zero-configuration entrypoint for library authors.
 *
 * Example:
 *   const result = checkCompatFromSource(
 *     "src/boxes/my-box.ts",
 *     oldBox,
 *     newBox,
 *   );
 */
export function checkCompatFromSource(
  sourceFilePath: string,
  oldBox: (...args: any[]) => any,
  newBox: (...args: any[]) => any,
  boxName?: string,
): CompatResult {
  const schemas = extractSchemas(sourceFilePath);
  if (schemas.length === 0) {
    throw new Error(`No box schemas found in ${sourceFilePath}`);
  }

  const schema = boxName
    ? schemas.find(s => s.boxName === boxName)?.schema
    : schemas[0].schema;

  if (!schema) {
    throw new Error(`Box "${boxName}" not found in ${sourceFilePath}`);
  }

  return checkCompatAuto(oldBox, newBox, schema);
}

// === Internals ===

function levelOrdinal(level: CompatLevel): number {
  switch (level) {
    case "strict": return 0;
    case "patch": return 1;
    case "breaking": return 2;
  }
}

function synthInIsolation(fn: () => void): Template {
  resetAll();
  fn();
  return synth();
}

function compareTemplates(oldT: Template, newT: Template): CompatResult {
  const diffs: ResourceDiff[] = [];
  const oldIds = new Set(Object.keys(oldT.Resources));
  const newIds = new Set(Object.keys(newT.Resources));

  const removedResources: string[] = [];
  const addedResources: string[] = [];

  for (const id of oldIds) {
    if (!newIds.has(id)) {
      removedResources.push(id);
      diffs.push({ logicalId: id, kind: "removed" });
    }
  }

  for (const id of newIds) {
    if (!oldIds.has(id)) {
      addedResources.push(id);
    }
  }

  for (const id of oldIds) {
    if (!newIds.has(id)) continue;

    const oldR = oldT.Resources[id];
    const newR = newT.Resources[id];

    if (oldR.Type !== newR.Type) {
      diffs.push({ logicalId: id, kind: "type-changed", oldType: oldR.Type, newType: newR.Type });
      continue;
    }

    const propDiffs = diffProperties(
      oldR.Properties as Record<string, unknown> ?? {},
      newR.Properties as Record<string, unknown> ?? {},
      "",
    );

    if (propDiffs.length > 0) {
      diffs.push({ logicalId: id, kind: "property-diff", diffs: propDiffs });
    }
  }

  const templatesIdentical = JSON.stringify(oldT) === JSON.stringify(newT);

  let level: CompatLevel;
  if (templatesIdentical) {
    level = "strict";
  } else if (diffs.length === 0) {
    level = "patch";
  } else {
    const hasBreaking = diffs.some(d =>
      d.kind === "removed" || d.kind === "type-changed" ||
      (d.kind === "property-diff" && d.diffs.some(p => p.kind === "removed" || p.kind === "changed"))
    );
    level = hasBreaking ? "breaking" : "patch";
  }

  return {
    level,
    diffs,
    oldResourceCount: oldIds.size,
    newResourceCount: newIds.size,
    addedResources,
    removedResources,
  };
}

function diffProperties(
  oldProps: unknown,
  newProps: unknown,
  path: string,
): PropertyDiff[] {
  if (oldProps === newProps) return [];
  if (JSON.stringify(oldProps) === JSON.stringify(newProps)) return [];

  if (oldProps === null || oldProps === undefined) return [];
  if (newProps === null || newProps === undefined) {
    return [{ path: path || "(root)", kind: "removed", oldValue: oldProps }];
  }

  if (typeof oldProps !== "object" || typeof newProps !== "object") {
    return [{ path: path || "(root)", kind: "changed", oldValue: oldProps, newValue: newProps }];
  }

  if (Array.isArray(oldProps)) {
    if (!Array.isArray(newProps)) {
      return [{ path: path || "(root)", kind: "type-changed", oldValue: "array", newValue: typeof newProps }];
    }
    const diffs: PropertyDiff[] = [];
    for (let i = 0; i < oldProps.length; i++) {
      if (i >= newProps.length) {
        diffs.push({ path: `${path}[${i}]`, kind: "removed", oldValue: oldProps[i] });
      } else {
        diffs.push(...diffProperties(oldProps[i], newProps[i], `${path}[${i}]`));
      }
    }
    return diffs;
  }

  const objOld = oldProps as Record<string, unknown>;
  const objNew = newProps as Record<string, unknown>;
  const diffs: PropertyDiff[] = [];

  for (const key of Object.keys(objOld)) {
    const childPath = path ? `${path}.${key}` : key;
    if (!(key in objNew)) {
      diffs.push({ path: childPath, kind: "removed", oldValue: objOld[key] });
    } else {
      diffs.push(...diffProperties(objOld[key], objNew[key], childPath));
    }
  }

  return diffs;
}

/**
 * Formats a CompatResult into a human-readable report.
 */
export function formatCompatReport(result: CompatResult): string {
  const lines: string[] = [];

  switch (result.level) {
    case "strict":
      lines.push("✓ Strictly compatible (identical output)");
      break;
    case "patch":
      lines.push("✓ Patch-compatible (additive changes only)");
      break;
    case "breaking":
      lines.push("✗ BREAKING CHANGE");
      break;
  }

  lines.push(`  Resources: ${result.oldResourceCount} → ${result.newResourceCount}`);

  if (result.addedResources.length > 0) {
    lines.push(`  Added: ${result.addedResources.join(", ")}`);
  }

  if (result.removedResources.length > 0) {
    lines.push(`  Removed: ${result.removedResources.join(", ")}`);
  }

  for (const diff of result.diffs) {
    switch (diff.kind) {
      case "removed":
        lines.push(`  ✗ ${diff.logicalId}: resource removed`);
        break;
      case "type-changed":
        lines.push(`  ✗ ${diff.logicalId}: type changed (${diff.oldType} → ${diff.newType})`);
        break;
      case "property-diff":
        for (const p of diff.diffs) {
          switch (p.kind) {
            case "removed":
              lines.push(`  ✗ ${diff.logicalId}.${p.path}: removed`);
              break;
            case "changed":
              lines.push(`  ✗ ${diff.logicalId}.${p.path}: changed`);
              break;
            case "type-changed":
              lines.push(`  ✗ ${diff.logicalId}.${p.path}: type changed`);
              break;
          }
        }
        break;
    }
  }

  return lines.join("\n");
}
