import { resetTokens } from "../runtime/tokens.js";
import { resetRegistry } from "../runtime/registry.js";
import { resetConditions } from "../runtime/conditions.js";
import { resetMappings } from "../runtime/mappings.js";
import { resetParameters } from "../runtime/parameters.js";
import { resetOutputs } from "../runtime/outputs.js";
import { resetStacks } from "../runtime/stacks.js";
import { resetAssets, setAssetEnvironment } from "../runtime/assets.js";
import { resetGraph } from "../runtime/graph.js";
import { synth, Template, TemplateResource } from "../runtime/synth.js";

export function resetAll(): void {
  resetTokens();
  resetRegistry();
  resetConditions();
  resetMappings();
  resetParameters();
  resetOutputs();
  resetStacks();
  resetAssets();
  resetGraph();
  setAssetEnvironment({ account: "123456789012", region: "us-east-1" });
}

export function synthTest(fn: () => void): Template {
  resetAll();
  fn();
  return synth();
}

export function hasResource(
  template: Template,
  logicalId: string,
  expected?: { type?: string; properties?: Record<string, unknown> },
): boolean {
  const resource = template.Resources[logicalId];
  if (!resource) return false;
  if (expected?.type && resource.Type !== expected.type) return false;
  if (expected?.properties) {
    return containsSubset(resource.Properties as Record<string, unknown>, expected.properties);
  }
  return true;
}

export function hasOutput(
  template: Template,
  name: string,
  expected?: { value?: unknown },
): boolean {
  if (!template.Outputs) return false;
  const output = template.Outputs[name] as Record<string, unknown> | undefined;
  if (!output) return false;
  if (expected?.value) {
    return JSON.stringify(output.Value) === JSON.stringify(expected.value);
  }
  return true;
}

export function resourceCount(template: Template): number {
  return Object.keys(template.Resources).length;
}

export function resourceCountIs(template: Template, expected: number): boolean {
  return resourceCount(template) === expected;
}

export function resourceOfType(template: Template, type: string): TemplateResource[] {
  return Object.values(template.Resources).filter((r) => r.Type === type);
}

export function resourceIds(template: Template): string[] {
  return Object.keys(template.Resources);
}

function containsSubset(actual: unknown, expected: unknown): boolean {
  if (expected === actual) return true;
  if (expected === null || actual === null) return expected === actual;
  if (typeof expected !== "object" || typeof actual !== "object") {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  for (const [key, value] of Object.entries(expected as Record<string, unknown>)) {
    if (!containsSubset((actual as Record<string, unknown>)[key], value)) return false;
  }
  return true;
}
