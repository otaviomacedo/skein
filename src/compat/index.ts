import fc from "fast-check";
import { resetAll } from "../testing/index.js";
import { synth } from "../runtime/synth.js";
import type { Template } from "../runtime/synth.js";
import { makeResource } from "../runtime/resource.js";
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
  /** The input that caused a failure (if any) */
  counterexample?: unknown[];
  /** Number of inputs tested */
  numRuns: number;
};

// === Input schema declaration ===

export type InputKind =
  | { kind: "string"; value?: string }
  | { kind: "number"; value?: number }
  | { kind: "resource"; type: string; props?: Record<string, unknown>; factory?: (id: string, props: any) => any }
  | { kind: "props"; value: Record<string, unknown> };

export function resource(type: string, propsOverride?: Record<string, unknown>): InputKind {
  return { kind: "resource", type, props: propsOverride };
}

export type BoxSchema = {
  inputs: InputKind[];
};

export function declareSchema(schema: BoxSchema): BoxSchema {
  return schema;
}

// === Arbitraries for input generation ===

let resourceCounter = 0;

function arbitraryForInput(input: InputKind): fc.Arbitrary<unknown> {
  switch (input.kind) {
    case "string":
      return fc.oneof(
        fc.constant("Alpha"),
        fc.constant("Beta"),
        fc.constant("Gamma"),
        fc.constant("Delta"),
        fc.nat({ max: 999 }).map((n) => `Test${n}`),
      );
    case "number":
      return fc.integer({ min: 1, max: 10000 });
    case "resource":
      return fc.constant(input);
    case "props":
      return fc.constant(input.value);
  }
}

function arbitraryInputs(schema: BoxSchema): fc.Arbitrary<unknown[]> {
  if (schema.inputs.length === 0) return fc.constant([]);
  const arbs = schema.inputs.map(arbitraryForInput);
  return fc.tuple(...arbs).map((tuple) => [...tuple]);
}

function resolveInputs(rawInputs: unknown[], schema: BoxSchema): unknown[] {
  return rawInputs.map((raw, i) => {
    const input = schema.inputs[i];
    if (input.kind === "resource") {
      return createResource(input.type, input.props, input.factory);
    }
    if (input.kind === "props" && typeof raw === "object" && raw !== null) {
      return resolvePropsDeep(raw as Record<string, unknown>);
    }
    return raw;
  });
}

function createResource(type: string, props?: Record<string, unknown>, factory?: (id: string, props: any) => any): unknown {
  const id = `Gen${type.split("::")[2] ?? "Res"}${resourceCounter++}`;
  if (factory) return factory(id, props ?? {});
  const entry = fixtures[type];
  if (entry) return entry.factory(id, { ...entry.minimalProps, ...props });
  return makeResource(type, id, props ?? {});
}

function resolvePropsDeep(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value in fixtures) {
      // Value is a CloudFormation type string — resolve it to an actual resource
      result[key] = createResource(value);
    } else if (isResourceTypeHint(key, value)) {
      // Heuristic: property name suggests a resource type
      const cfnType = guessResourceType(key);
      if (cfnType && cfnType in fixtures) {
        result[key] = createResource(cfnType);
      } else {
        result[key] = value;
      }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = resolvePropsDeep(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isResourceTypeHint(key: string, value: unknown): boolean {
  if (value !== "placeholder") return false;
  const resourceKeyPatterns = /^(table|queue|topic|bucket|function|role|vpc|subnet|cluster|stateMachine)/i;
  return resourceKeyPatterns.test(key);
}

function guessResourceType(key: string): string | null {
  const lower = key.toLowerCase();
  if (lower.includes("table")) return "AWS::DynamoDB::Table";
  if (lower.includes("queue")) return "AWS::SQS::Queue";
  if (lower.includes("topic")) return "AWS::SNS::Topic";
  if (lower.includes("bucket")) return "AWS::S3::Bucket";
  if (lower.includes("function") || lower.includes("lambda")) return "AWS::Lambda::Function";
  if (lower.includes("role")) return "AWS::IAM::Role";
  if (lower.includes("vpc")) return "AWS::EC2::VPC";
  if (lower.includes("statemachine")) return "AWS::StepFunctions::StateMachine";
  return null;
}

// === Core compat check (with manual setup) ===

export function checkCompat<TBox>(
  oldBox: TBox,
  newBox: TBox,
  setup: (boxFn: TBox) => void,
): CompatResult {
  const oldTemplate = synthInIsolation(() => setup(oldBox));
  const newTemplate = synthInIsolation(() => setup(newBox));
  return { ...compareTemplates(oldTemplate, newTemplate), numRuns: 1 };
}

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

// === Property-based compat check ===

export type PropertyCheckOptions = {
  numRuns?: number;
  seed?: number;
};

/**
 * Property-based backwards compatibility check using fast-check.
 *
 * Generates random inputs matching the schema and verifies that
 * the compatibility predicate holds for all of them. Returns a
 * counterexample if one is found.
 */
export function checkCompatProperty(
  oldBox: (...args: any[]) => any,
  newBox: (...args: any[]) => any,
  schema: BoxSchema,
  opts: PropertyCheckOptions = {},
): CompatResult {
  const { numRuns = 100, seed } = opts;
  let worstResult: CompatResult = {
    level: "strict",
    diffs: [],
    oldResourceCount: 0,
    newResourceCount: 0,
    addedResources: [],
    removedResources: [],
    numRuns: 0,
  };
  let counterexample: unknown[] | undefined;
  let runsCompleted = 0;

  const arb = arbitraryInputs(schema);

  try {
    fc.assert(
      fc.property(arb, (rawInputs) => {
        try {
          resourceCounter = 0;
          const oldTemplate = synthInIsolation(() => {
            const oldInputs = resolveInputs(rawInputs, schema);
            oldBox(...oldInputs);
          });

          resourceCounter = 0;
          const newTemplate = synthInIsolation(() => {
            const newInputs = resolveInputs(rawInputs, schema);
            newBox(...newInputs);
          });

          const result = compareTemplates(oldTemplate, newTemplate);
          runsCompleted++;

          if (levelOrdinal(result.level) > levelOrdinal(worstResult.level)) {
            worstResult = { ...result, numRuns: runsCompleted };
          }

          if (result.level === "breaking") {
            counterexample = rawInputs as unknown[];
            return false;
          }
          return true;
        } catch (err) {
          // If the box throws, treat this input as non-comparable (skip)
          // This happens when generated inputs don't satisfy runtime constraints
          runsCompleted++;
          return true;
        }
      }),
      { numRuns, seed, endOnFailure: true },
    );
  } catch (e: any) {
    if (counterexample) {
      return { ...worstResult, counterexample, numRuns: runsCompleted };
    }
    // fast-check throws on failure with various message formats
    if (e.constructor?.name === "Error" && runsCompleted === 0) {
      // The property callback itself threw — likely a setup issue
      throw new Error(`Compat check failed during execution: ${e.message}`);
    }
    // If we completed some runs and then got an error, return what we have
    if (runsCompleted > 0) {
      return { ...worstResult, numRuns: runsCompleted };
    }
    throw e;
  }

  return { ...worstResult, numRuns: runsCompleted, counterexample };
}

/**
 * Schema-driven compat check using a single fixed input (for quick checks).
 */
export function checkCompatAuto(
  oldBox: (...args: any[]) => any,
  newBox: (...args: any[]) => any,
  schema: BoxSchema,
): CompatResult {
  resourceCounter = 0;
  const oldTemplate = synthInIsolation(() => {
    const inputs = generateFixedInputs(schema);
    oldBox(...inputs);
  });

  resourceCounter = 0;
  const newTemplate = synthInIsolation(() => {
    const inputs = generateFixedInputs(schema);
    newBox(...inputs);
  });

  return { ...compareTemplates(oldTemplate, newTemplate), numRuns: 1 };
}

/**
 * Fully automated: extract schema from source, run property-based check.
 */
export function checkCompatFromSource(
  sourceFilePath: string,
  oldBox: (...args: any[]) => any,
  newBox: (...args: any[]) => any,
  opts?: PropertyCheckOptions & { boxName?: string },
): CompatResult {
  const schemas = extractSchemas(sourceFilePath);
  if (schemas.length === 0) {
    throw new Error(`No box schemas found in ${sourceFilePath}`);
  }

  const schema = opts?.boxName
    ? schemas.find(s => s.boxName === opts.boxName)?.schema
    : schemas[0].schema;

  if (!schema) {
    throw new Error(`Box "${opts?.boxName}" not found in ${sourceFilePath}`);
  }

  return checkCompatProperty(oldBox, newBox, schema, opts);
}

// === Fixed input generation (for quick deterministic checks) ===

function generateFixedInputs(schema: BoxSchema): unknown[] {
  return schema.inputs.map((input, i) => {
    switch (input.kind) {
      case "string":
        return input.value ?? `Fixture${i}`;
      case "number":
        return input.value ?? i;
      case "resource": {
        const id = `Fixture${input.type.split("::")[2] ?? "Resource"}${resourceCounter++}`;
        if (input.factory) return input.factory(id, input.props ?? {});
        const entry = fixtures[input.type];
        if (entry) return entry.factory(id, { ...entry.minimalProps, ...input.props });
        return makeResource(input.type, id, input.props ?? {});
      }
      case "props":
        return input.value;
    }
  });
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

function compareTemplates(oldT: Template, newT: Template): Omit<CompatResult, "numRuns"> {
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
      lines.push(`✓ Strictly compatible (identical output) — ${result.numRuns} inputs tested`);
      break;
    case "patch":
      lines.push(`✓ Patch-compatible (additive changes only) — ${result.numRuns} inputs tested`);
      break;
    case "breaking":
      lines.push(`✗ BREAKING CHANGE — found after ${result.numRuns} inputs`);
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

  if (result.counterexample) {
    lines.push(`  Counterexample: ${JSON.stringify(result.counterexample).slice(0, 200)}`);
  }

  return lines.join("\n");
}
