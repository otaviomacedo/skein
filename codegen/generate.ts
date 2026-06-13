import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

type CfnSpec = {
  ResourceTypes: Record<string, ResourceSpec>;
  PropertyTypes: Record<string, PropertyTypeSpec>;
};

type ResourceSpec = {
  Properties?: Record<string, PropertyDef>;
  Attributes?: Record<string, AttributeDef>;
};

type PropertyTypeSpec = {
  Properties?: Record<string, PropertyDef>;
};

type PropertyDef = {
  Required?: boolean;
  PrimitiveType?: string;
  Type?: string;
  ItemType?: string;
  PrimitiveItemType?: string;
};

type AttributeDef = {
  PrimitiveType?: string;
  Type?: string;
};

type RelationshipData = Record<string, {
  relationships?: Record<string, Array<{
    cloudformationType: string;
    propertyPath: string;
  }>>;
}>;

type TypedRef = {
  propName: string;
  targetCfnType: string;
  targetResourceName: string;
  targetService: string;
  attribute: string;
};

const PRIMITIVE_MAP: Record<string, string> = {
  String: "string",
  Integer: "number",
  Long: "number",
  Double: "number",
  Boolean: "boolean",
  Timestamp: "string",
  Json: "Record<string, unknown>",
};

function toCamelCase(name: string): string {
  let i = 0;
  while (i < name.length && name[i] === name[i].toUpperCase() && /[A-Z]/.test(name[i])) {
    i++;
  }
  if (i === 0) return name;
  if (i === 1) return name[0].toLowerCase() + name.slice(1);
  if (i === name.length) return name.toLowerCase();
  return name.slice(0, i - 1).toLowerCase() + name.slice(i - 1);
}

function toServiceNamespace(cfnType: string): string {
  const parts = cfnType.split("::");
  return parts[1].toLowerCase();
}

const RESERVED_NAMES = new Set(["Resource", "Function"]);

function toResourceName(cfnType: string): string {
  const parts = cfnType.split("::");
  const name = parts[2];
  if (RESERVED_NAMES.has(name)) {
    return `${parts[1]}${name}`;
  }
  return name;
}

function attributeFromPropertyPath(propertyPath: string): string {
  // "/properties/Arn" → "Arn"
  const parts = propertyPath.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

function resolveTypedRefs(
  cfnType: string,
  relationships: RelationshipData,
  allResourceTypes: Set<string>,
  spec: CfnSpec,
): TypedRef[] {
  const entry = relationships[cfnType];
  if (!entry?.relationships) return [];

  const resourceSpec = spec.ResourceTypes[cfnType];
  const props = resourceSpec?.Properties ?? {};

  const refs: TypedRef[] = [];
  for (const [propPath, targets] of Object.entries(entry.relationships)) {
    if (propPath.includes("/")) continue;
    if (targets.length !== 1) continue;

    const propDef = props[propPath];
    if (!propDef) continue;
    if (propDef.PrimitiveType !== "String") continue;
    if (propDef.Type === "List" || propDef.Type === "Map") continue;

    const target = targets[0];
    if (!allResourceTypes.has(target.cloudformationType)) continue;

    const attribute = attributeFromPropertyPath(target.propertyPath);

    // Verify the attribute exists on the target resource
    const targetSpec = spec.ResourceTypes[target.cloudformationType];
    const targetAttrs = targetSpec?.Attributes ?? {};
    const simpleAttrs = Object.keys(targetAttrs).filter((k) => !k.includes("."));
    if (!simpleAttrs.includes(attribute)) continue;

    refs.push({
      propName: propPath,
      targetCfnType: target.cloudformationType,
      targetResourceName: toResourceName(target.cloudformationType),
      targetService: toServiceNamespace(target.cloudformationType),
      attribute,
    });
  }

  return refs;
}

function resolvePropertyType(
  prop: PropertyDef,
  resourcePrefix: string,
  spec: CfnSpec,
): string {
  const resourceName = toResourceName(resourcePrefix);

  if (prop.PrimitiveType) {
    return PRIMITIVE_MAP[prop.PrimitiveType] ?? "unknown";
  }

  if (prop.Type === "List") {
    if (prop.PrimitiveItemType) {
      return `Array<${PRIMITIVE_MAP[prop.PrimitiveItemType] ?? "unknown"}>`;
    }
    if (prop.ItemType) {
      if (prop.ItemType === "Tag") {
        return "Array<Tag>";
      }
      const fullType = `${resourcePrefix}.${prop.ItemType}`;
      if (spec.PropertyTypes[fullType]) {
        return `Array<${resourceName}_${prop.ItemType}>`;
      }
      return "Array<Record<string, unknown>>";
    }
    return "unknown[]";
  }

  if (prop.Type === "Map") {
    if (prop.PrimitiveItemType) {
      return `Record<string, ${PRIMITIVE_MAP[prop.PrimitiveItemType] ?? "unknown"}>`;
    }
    if (prop.ItemType) {
      const fullType = `${resourcePrefix}.${prop.ItemType}`;
      if (spec.PropertyTypes[fullType]) {
        return `Record<string, ${resourceName}_${prop.ItemType}>`;
      }
      return "Record<string, unknown>";
    }
    return "Record<string, unknown>";
  }

  if (prop.Type === "Tag") {
    return "Tag";
  }

  if (prop.Type) {
    const fullType = `${resourcePrefix}.${prop.Type}`;
    if (spec.PropertyTypes[fullType]) {
      return `${resourceName}_${prop.Type}`;
    }
    return "Record<string, unknown>";
  }

  return "unknown";
}

function generatePropertyInterface(
  name: string,
  props: Record<string, PropertyDef>,
  resourcePrefix: string,
  spec: CfnSpec,
  typedRefOverrides?: Map<string, string>,
): string {
  const lines: string[] = [];
  lines.push(`export interface ${name} {`);

  for (const [propName, propDef] of Object.entries(props)) {
    const override = typedRefOverrides?.get(propName);
    const tsType = override ?? resolvePropertyType(propDef, resourcePrefix, spec);
    const optional = propDef.Required ? "" : "?";
    lines.push(`  ${toCamelCase(propName)}${optional}: ${tsType};`);
  }

  lines.push("}");
  return lines.join("\n");
}

function generateSubPropertyInterfaces(
  resourceType: string,
  spec: CfnSpec,
): string[] {
  const prefix = resourceType;
  const resourceName = toResourceName(resourceType);
  const results: string[] = [];
  const generated = new Set<string>();

  for (const [fullName, typeDef] of Object.entries(spec.PropertyTypes)) {
    if (!fullName.startsWith(prefix + ".")) continue;
    const shortName = fullName.slice(prefix.length + 1);
    if (generated.has(shortName)) continue;
    generated.add(shortName);

    const interfaceName = `${resourceName}_${shortName}`;

    if (typeDef.Properties) {
      results.push(generatePropertyInterface(interfaceName, typeDef.Properties, prefix, spec));
    } else {
      const aliasedType = resolvePropertyType(typeDef as unknown as PropertyDef, prefix, spec);
      results.push(`export type ${interfaceName} = ${aliasedType};`);
    }
  }

  return results;
}

function generateAttributeUnion(attributes: Record<string, AttributeDef>): string {
  const simpleAttrs = Object.keys(attributes).filter((k) => !k.includes("."));
  if (simpleAttrs.length === 0) return "";
  const union = simpleAttrs.map((a) => `"${a}"`).join(" | ");
  return union;
}

function generateResource(
  cfnType: string,
  resourceSpec: ResourceSpec,
  spec: CfnSpec,
  typedRefs: TypedRef[],
): string {
  const resourceName = toResourceName(cfnType);
  const propsName = `${resourceName}Props`;
  const attrs = resourceSpec.Attributes ?? {};
  const props = resourceSpec.Properties ?? {};

  const lines: string[] = [];

  // Sub-property interfaces
  const subInterfaces = generateSubPropertyInterfaces(cfnType, spec);
  for (const iface of subInterfaces) {
    lines.push(iface);
    lines.push("");
  }

  // Props interface (with typed ref overrides)
  if (Object.keys(props).length > 0) {
    const overrides = new Map<string, string>();
    for (const tr of typedRefs) {
      overrides.set(tr.propName, tr.targetResourceName);
    }
    lines.push(generatePropertyInterface(propsName, props, cfnType, spec, overrides));
    lines.push("");
  }

  // Attribute union
  const attrUnion = generateAttributeUnion(attrs);
  if (attrUnion) {
    lines.push(`export type ${resourceName}Attributes = ${attrUnion};`);
    lines.push("");
  }

  // Resource type (includes typed ref fields)
  const refFields = typedRefs.map((tr) => `${toCamelCase(tr.propName)}: ${tr.targetResourceName}`).join("; ");
  const refExtension = refFields ? ` & { ${refFields} }` : "";
  const propsType = Object.keys(props).length > 0 ? `{ properties: ${propsName} }` : "{}";
  lines.push(
    `export type ${resourceName} = Resource<"${cfnType}"> & ${propsType}${refExtension};`,
  );
  lines.push("");

  // Generator function
  if (Object.keys(props).length > 0) {
    lines.push(
      `export function mk${resourceName}(logicalId: string, props: ${propsName}): ${resourceName} {`,
    );
    if (typedRefs.length > 0) {
      // Build raw props with resolution, attach typed fields
      lines.push(`  const rawProps: Record<string, unknown> = { ...props as any };`);
      for (const tr of typedRefs) {
        const camel = toCamelCase(tr.propName);
        lines.push(`  if (props.${camel}) rawProps.${camel} = get${tr.targetResourceName}Att(props.${camel}, "${tr.attribute}");`);
      }
      lines.push(`  const resource = makeResource("${cfnType}", logicalId, rawProps);`);
      const assigns = typedRefs.map((tr) => `${toCamelCase(tr.propName)}: props.${toCamelCase(tr.propName)}`).join(", ");
      lines.push(`  return Object.assign(resource, { ${assigns} }) as ${resourceName};`);
    } else {
      lines.push(
        `  return makeResource("${cfnType}", logicalId, props) as ${resourceName};`,
      );
    }
    lines.push("}");
  } else {
    lines.push(
      `export function mk${resourceName}(logicalId: string): ${resourceName} {`,
    );
    lines.push(
      `  return makeResource("${cfnType}", logicalId, {}) as ${resourceName};`,
    );
    lines.push("}");
  }
  lines.push("");

  // Typed getAtt helper
  if (attrUnion) {
    lines.push(
      `export function get${resourceName}Att(resource: ${resourceName}, attribute: ${resourceName}Attributes): string {`,
    );
    lines.push(`  return getAtt(resource, attribute);`);
    lines.push("}");
  }

  return lines.join("\n");
}

function generateServiceFile(
  service: string,
  resources: [string, ResourceSpec, TypedRef[]][],
  spec: CfnSpec,
): string {
  const lines: string[] = [];

  lines.push(`import { Resource, makeResource, getAtt } from "../runtime/resource.js";`);

  const needsTag = resources.some(([cfnType, rs]) => {
    const allProps = Object.values(rs.Properties ?? {});
    const subProps = Object.entries(spec.PropertyTypes)
      .filter(([k]) => k.startsWith(cfnType + "."))
      .flatMap(([, v]) => Object.values(v.Properties ?? {}));
    return [...allProps, ...subProps].some(
      (p) => p.Type === "Tag" || p.ItemType === "Tag",
    );
  });
  if (needsTag) {
    lines.push(`import { Tag } from "./common.js";`);
  }

  // Collect cross-service imports needed for typed refs
  const crossImports = new Map<string, Set<string>>();
  for (const [, , typedRefs] of resources) {
    for (const tr of typedRefs) {
      if (tr.targetService !== service) {
        if (!crossImports.has(tr.targetService)) crossImports.set(tr.targetService, new Set());
        crossImports.get(tr.targetService)!.add(tr.targetResourceName);
        crossImports.get(tr.targetService)!.add(`get${tr.targetResourceName}Att`);
      }
    }
  }
  for (const [svc, names] of crossImports) {
    lines.push(`import { ${[...names].join(", ")} } from "./${svc}.js";`);
  }

  // Check if we need getAtt helpers from within the same service for typed refs
  const selfRefs = new Set<string>();
  for (const [, , typedRefs] of resources) {
    for (const tr of typedRefs) {
      if (tr.targetService === service) {
        selfRefs.add(tr.targetResourceName);
      }
    }
  }

  lines.push("");

  for (const [cfnType, resourceSpec, typedRefs] of resources) {
    lines.push(generateResource(cfnType, resourceSpec, spec, typedRefs));
    lines.push("");
  }

  return lines.join("\n");
}

function generateIndex(services: Map<string, string[]>): string {
  const lines: string[] = [];
  for (const [service] of services) {
    lines.push(`export * as ${service} from "./${service}.js";`);
  }
  return lines.join("\n");
}

// --- Main ---

function main() {
  const specPath = process.argv[2];
  const outputDir = process.argv[3];

  if (!specPath || !outputDir) {
    console.error("Usage: generate <spec.json> <output-dir> [relationships.json]");
    process.exit(1);
  }

  const relationshipsPath = process.argv[4] ?? join(dirname(specPath), "relationships.json");

  const spec: CfnSpec = JSON.parse(readFileSync(specPath, "utf-8"));
  const relationships: RelationshipData = existsSync(relationshipsPath)
    ? JSON.parse(readFileSync(relationshipsPath, "utf-8"))
    : {};

  mkdirSync(outputDir, { recursive: true });

  const allResourceTypes = new Set(Object.keys(spec.ResourceTypes));

  // Group resources by service, with typed refs
  const serviceMap = new Map<string, [string, ResourceSpec, TypedRef[]][]>();
  for (const [cfnType, resourceSpec] of Object.entries(spec.ResourceTypes)) {
    const service = toServiceNamespace(cfnType);
    if (!serviceMap.has(service)) serviceMap.set(service, []);
    const typedRefs = resolveTypedRefs(cfnType, relationships, allResourceTypes, spec);
    serviceMap.get(service)!.push([cfnType, resourceSpec, typedRefs]);
  }

  const totalRefs = [...serviceMap.values()].flat().reduce((sum, [, , refs]) => sum + refs.length, 0);
  console.log(`Generating ${serviceMap.size} service modules from ${allResourceTypes.size} resource types (${totalRefs} typed references)...`);

  // Write common.ts
  writeFileSync(join(outputDir, "common.ts"), `export interface Tag { key: string; value: string; }\n`);

  const serviceExports = new Map<string, string[]>();

  for (const [service, resources] of serviceMap) {
    const content = generateServiceFile(service, resources, spec);
    const filePath = join(outputDir, `${service}.ts`);
    writeFileSync(filePath, content);
    serviceExports.set(service, resources.map(([t]) => toResourceName(t)));
  }

  // Generate index
  const indexContent = `export { Tag } from "./common.js";\n` + generateIndex(serviceExports);
  writeFileSync(join(outputDir, "index.ts"), indexContent);

  console.log(`Done.`);
}

main();
