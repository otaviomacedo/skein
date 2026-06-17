import { getPatches, getDiscarded, getResourceConditions, getResourceMetadata, getExplicitDeps } from "./registry.js";
import { mergePatchesByLogicalId, MergedResource } from "./merge.js";
import { resolveValue } from "./tokens.js";
import { getConditions } from "./conditions.js";
import { getMappings } from "./mappings.js";
import { getParameters } from "./parameters.js";
import { getOutputs } from "./outputs.js";
import { getStackAssignments } from "./stacks.js";
import { ReferenceError as SkeinRefError, CycleError } from "./errors.js";

export type TemplateResource = {
  Type: string;
  Properties: unknown;
  DependsOn?: string[];
  Condition?: string;
  Metadata?: Record<string, unknown>;
};

export type Template = {
  AWSTemplateFormatVersion: string;
  Parameters?: Record<string, unknown>;
  Conditions?: Record<string, unknown>;
  Mappings?: Record<string, Record<string, Record<string, unknown>>>;
  Resources: Record<string, TemplateResource>;
  Outputs?: Record<string, unknown>;
};

export function synth(): Template {
  const patches = getPatches();
  const discarded = getDiscarded();
  const resourceConditions = getResourceConditions();
  const resourceMetadataMap = getResourceMetadata();

  const merged = mergePatchesByLogicalId(patches);

  const live = merged.filter((r) => !discarded.has(r.logicalId));

  const resolved = live.map((r) => ({
    ...r,
    properties: toPascalCaseKeys(resolveValue(r.properties) as Record<string, unknown>),
  }));

  const deps = computeDependencies(resolved);
  const explicit = getExplicitDeps();
  for (const [from, tos] of explicit) {
    const existing = deps.get(from) ?? [];
    const merged = new Set([...existing, ...tos]);
    deps.set(from, [...merged].sort());
  }

  validate(resolved, deps);

  const resources: Template["Resources"] = {};
  for (const r of resolved) {
    const entry: TemplateResource = {
      Type: r.type,
      Properties: r.properties,
    };
    const resourceDeps = deps.get(r.logicalId);
    if (resourceDeps && resourceDeps.length > 0) {
      entry.DependsOn = resourceDeps;
    }
    const condition = resourceConditions.get(r.logicalId);
    if (condition) {
      entry.Condition = condition;
    }
    const metadata = resourceMetadataMap.get(r.logicalId);
    if (metadata) {
      entry.Metadata = metadata;
    }
    resources[r.logicalId] = entry;
  }

  const template: Template = { AWSTemplateFormatVersion: "2010-09-09", Resources: resources };

  const parameters = getParameters();
  if (parameters.size > 0) {
    template.Parameters = Object.fromEntries(
      Array.from(parameters.entries()).map(([name, def]) => [name, {
        Type: def.type,
        ...(def.default !== undefined && { Default: def.default }),
        ...(def.description && { Description: def.description }),
        ...(def.allowedValues && { AllowedValues: def.allowedValues }),
        ...(def.noEcho && { NoEcho: def.noEcho }),
      }]),
    );
  }

  const conditions = getConditions();
  if (conditions.size > 0) {
    template.Conditions = Object.fromEntries(
      Array.from(conditions.entries()).map(([name, expr]) => [name, resolveValue(expr)]),
    );
  }

  const mappings = getMappings();
  if (mappings.size > 0) {
    template.Mappings = Object.fromEntries(mappings);
  }

  const outputs = getOutputs();
  if (outputs.size > 0) {
    template.Outputs = Object.fromEntries(
      Array.from(outputs.entries()).map(([name, def]) => [name, {
        Value: resolveValue(def.value),
        ...(def.description && { Description: def.description }),
        ...(def.exportName && { Export: { Name: def.exportName } }),
        ...(def.condition && { Condition: def.condition }),
      }]),
    );
  }

  return template;
}

const PSEUDO_PARAMETERS = new Set([
  "AWS::AccountId",
  "AWS::NotificationARNs",
  "AWS::NoValue",
  "AWS::Partition",
  "AWS::Region",
  "AWS::StackId",
  "AWS::StackName",
  "AWS::URLSuffix",
]);

function computeDependencies(
  resources: MergedResource[],
): Map<string, string[]> {
  const ids = new Set(resources.map((r) => r.logicalId));
  const deps = new Map<string, string[]>();
  const allRefs = new Map<string, Set<string>>();

  for (const r of resources) {
    const referenced = new Set<string>();
    walkIntrinsics(r.properties, (intrinsic) => {
      if ("Ref" in intrinsic && typeof intrinsic.Ref === "string") {
        referenced.add(intrinsic.Ref);
      }
      if ("Fn::GetAtt" in intrinsic) {
        const getAtt = intrinsic["Fn::GetAtt"];
        if (Array.isArray(getAtt) && typeof getAtt[0] === "string") {
          referenced.add(getAtt[0]);
        }
      }
    });
    referenced.delete(r.logicalId);
    allRefs.set(r.logicalId, referenced);

    const internalDeps = [...referenced].filter((id) => ids.has(id));
    if (internalDeps.length > 0) {
      deps.set(r.logicalId, internalDeps.sort());
    }
  }

  return deps;
}

function collectAllReferences(resources: MergedResource[]): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  for (const r of resources) {
    const referenced = new Set<string>();
    walkIntrinsics(r.properties, (intrinsic) => {
      if ("Ref" in intrinsic && typeof intrinsic.Ref === "string") {
        referenced.add(intrinsic.Ref);
      }
      if ("Fn::GetAtt" in intrinsic) {
        const getAtt = intrinsic["Fn::GetAtt"];
        if (Array.isArray(getAtt) && typeof getAtt[0] === "string") {
          referenced.add(getAtt[0]);
        }
      }
    });
    referenced.delete(r.logicalId);
    refs.set(r.logicalId, referenced);
  }
  return refs;
}

function walkIntrinsics(
  value: unknown,
  visitor: (intrinsic: Record<string, unknown>) => void,
): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const item of value) walkIntrinsics(item, visitor);
    return;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("Ref" in obj || "Fn::GetAtt" in obj || "Fn::Sub" in obj) {
      visitor(obj);
    }
    for (const v of Object.values(obj)) {
      walkIntrinsics(v, visitor);
    }
  }
}

function validate(
  resources: MergedResource[],
  deps: Map<string, string[]>,
): void {
  const ids = new Set(resources.map((r) => r.logicalId));
  const paramNames = new Set(getParameters().keys());
  const conditionNames = new Set(getConditions().keys());
  const allRefs = collectAllReferences(resources);

  for (const [id, referenced] of allRefs) {
    for (const target of referenced) {
      if (
        !ids.has(target) &&
        !PSEUDO_PARAMETERS.has(target) &&
        !paramNames.has(target) &&
        !conditionNames.has(target) &&
        !target.startsWith("__asset_")
      ) {
        throw new SkeinRefError(id, target);
      }
    }
  }

  detectCycles(ids, deps);
}

function detectCycles(
  ids: Set<string>,
  deps: Map<string, string[]>,
): void {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const path: string[] = [];

  function visit(id: string): void {
    if (inStack.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id];
      throw new CycleError(id, cycle);
    }
    if (visited.has(id)) return;

    inStack.add(id);
    path.push(id);
    const neighbors = deps.get(id) ?? [];
    for (const n of neighbors) {
      visit(n);
    }
    path.pop();
    inStack.delete(id);
    visited.add(id);
  }

  for (const id of ids) {
    visit(id);
  }
}

export type SynthOutput = {
  templates: Record<string, Template>;
  stackDependencies: Record<string, string[]>;
};

export function synthMulti(defaultStack: string = "default"): SynthOutput {
  const patches = getPatches();
  const discarded = getDiscarded();
  const stackAssignments = getStackAssignments();
  const resourceConditions = getResourceConditions();
  const resourceMetadataMap = getResourceMetadata();

  const merged = mergePatchesByLogicalId(patches);
  const live = merged.filter((r) => !discarded.has(r.logicalId));

  const resolved = live.map((r) => ({
    ...r,
    properties: toPascalCaseKeys(resolveValue(r.properties) as Record<string, unknown>),
  }));

  // Determine stack for each resource
  const resourceToStack = new Map<string, string>();
  for (const r of resolved) {
    resourceToStack.set(r.logicalId, stackAssignments.get(r.logicalId) ?? defaultStack);
  }

  // Group resources by stack
  const stackResources = new Map<string, MergedResource[]>();
  for (const r of resolved) {
    const stack = resourceToStack.get(r.logicalId)!;
    if (!stackResources.has(stack)) stackResources.set(stack, []);
    stackResources.get(stack)!.push(r);
  }

  // Detect cross-stack references and insert Outputs + Fn::GetStackOutput
  const crossStackOutputs = new Map<string, Map<string, { ref: unknown; attribute?: string }>>();
  const stackDeps = new Map<string, Set<string>>();

  for (const [stackName, resources] of stackResources) {
    for (const r of resources) {
      walkIntrinsics(r.properties, (intrinsic) => {
        let targetId: string | undefined;
        let attribute: string | undefined;

        if ("Ref" in intrinsic && typeof intrinsic.Ref === "string") {
          targetId = intrinsic.Ref;
        }
        if ("Fn::GetAtt" in intrinsic) {
          const ga = intrinsic["Fn::GetAtt"];
          if (Array.isArray(ga) && typeof ga[0] === "string") {
            targetId = ga[0];
            attribute = ga[1] as string;
          }
        }

        if (!targetId) return;
        const targetStack = resourceToStack.get(targetId);
        if (!targetStack || targetStack === stackName) return;

        // Cross-stack reference found
        if (!stackDeps.has(stackName)) stackDeps.set(stackName, new Set());
        stackDeps.get(stackName)!.add(targetStack);

        if (!crossStackOutputs.has(targetStack)) crossStackOutputs.set(targetStack, new Map());
        const outputKey = attribute ? `${targetId}${attribute}` : targetId;
        const outputValue = attribute
          ? { "Fn::GetAtt": [targetId, attribute] }
          : { Ref: targetId };
        crossStackOutputs.get(targetStack)!.set(outputKey, { ref: outputValue, attribute });
      });
    }
  }

  // Build templates
  const templates: Record<string, Template> = {};

  for (const [stackName, resources] of stackResources) {
    const ids = new Set(resources.map((r) => r.logicalId));
    const deps = computeDependencies(resources);

    const templateResources: Template["Resources"] = {};
    for (const r of resources) {
      const entry: TemplateResource = { Type: r.type, Properties: r.properties };
      const resourceDeps = deps.get(r.logicalId);
      if (resourceDeps && resourceDeps.length > 0) {
        entry.DependsOn = resourceDeps;
      }
      const condition = resourceConditions.get(r.logicalId);
      if (condition) entry.Condition = condition;
      const metadata = resourceMetadataMap.get(r.logicalId);
      if (metadata) entry.Metadata = metadata;
      templateResources[r.logicalId] = entry;
    }

    const template: Template = {
      AWSTemplateFormatVersion: "2010-09-09",
      Resources: templateResources,
    };

    // Add outputs for cross-stack references
    const outputs = crossStackOutputs.get(stackName);
    if (outputs && outputs.size > 0) {
      template.Outputs = {};
      for (const [key, { ref }] of outputs) {
        template.Outputs[key] = { Value: ref };
      }
    }

    templates[stackName] = template;
  }

  // Compute stack dependency order
  const stackDependencies: Record<string, string[]> = {};
  for (const [stack, deps] of stackDeps) {
    stackDependencies[stack] = [...deps].sort();
  }

  return { templates, stackDependencies };
}

const CAMEL_CASE_PROP = /^[a-z][a-zA-Z0-9]*$/;

const OPAQUE_JSON_KEYS = new Set([
  "policyDocument",
  "redrivePolicy",
  "redriveAllowPolicy",
  "resourcePolicy",
  "assumeRolePolicyDocument",
  "eventPattern",
  "routeSelectionExpression",
]);

function toPascalCase(key: string): string {
  if (!CAMEL_CASE_PROP.test(key)) return key;
  return key[0].toUpperCase() + key.slice(1);
}

function toPascalCaseKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (OPAQUE_JSON_KEYS.has(key)) {
      result[toPascalCase(key)] = value;
    } else {
      result[toPascalCase(key)] = toPascalCaseValue(value);
    }
  }
  return result;
}

function toPascalCaseValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(toPascalCaseValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.some(k => k === "Ref" || k.startsWith("Fn::"))) {
      return value;
    }
    return toPascalCaseKeys(obj);
  }
  return value;
}
