export type Resolvable =
  | { kind: "ref"; logicalId: string }
  | { kind: "getAtt"; logicalId: string; attribute: string }
  | { kind: "sub"; template: string }
  | { kind: "join"; delimiter: string; parts: unknown[] }
  | { kind: "select"; index: number; list: unknown };

const TOKEN_PREFIX = "${Token[";
const TOKEN_SUFFIX = "]}";
const TOKEN_REGEX = /\$\{Token\[([a-zA-Z0-9_]+)\]\}/g;

let tokenCounter = 0;
const tokenRegistry = new Map<string, Resolvable>();

export function mintToken(resolvable: Resolvable): string {
  const id = `t${tokenCounter++}`;
  const token = `${TOKEN_PREFIX}${id}${TOKEN_SUFFIX}`;
  tokenRegistry.set(id, resolvable);
  return token;
}

export function isToken(value: string): boolean {
  TOKEN_REGEX.lastIndex = 0;
  return TOKEN_REGEX.test(value);
}

export function extractLogicalId(value: string): string | undefined {
  TOKEN_REGEX.lastIndex = 0;
  const match = TOKEN_REGEX.exec(value);
  if (!match) return undefined;
  const resolvable = tokenRegistry.get(match[1]);
  if (!resolvable) return undefined;
  if (resolvable.kind === "ref") return resolvable.logicalId;
  if (resolvable.kind === "getAtt") return resolvable.logicalId;
  return undefined;
}

export function extractAllLogicalIds(value: string): string[] {
  const regex = new RegExp(TOKEN_REGEX.source, "g");
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const resolvable = tokenRegistry.get(match[1]);
    if (resolvable && (resolvable.kind === "ref" || resolvable.kind === "getAtt")) {
      ids.push(resolvable.logicalId);
    }
  }
  return ids;
}

export function isResource(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "__type" in (value as object) &&
    "logicalId" in (value as object)
  );
}

export type ResolutionStrategy =
  | { method: "ref" }
  | { method: "getAtt"; attribute: string };

const resolutionMap = new Map<string, ResolutionStrategy>();

export function registerResolution(propertyKey: string, strategy: ResolutionStrategy): void {
  resolutionMap.set(propertyKey, strategy);
}

export function resolveValue(value: unknown, propertyKey?: string): unknown {
  if (isResource(value)) {
    return resolveResourceRef(value as { __type: string; logicalId: string }, propertyKey);
  }
  if (isMarkerObject(value)) {
    return resolveMarker(value as { __kind: string });
  }
  if (typeof value === "string") return resolveString(value);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, propertyKey));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveValue(v, k)]),
    );
  }
  return value;
}

function isMarkerObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "__kind" in (value as object)
  );
}

function resolveMarker(marker: { __kind: string }): unknown {
  const m = marker as unknown as Record<string, unknown>;
  switch (marker.__kind) {
    case "conditionRef":
      return {
        "Fn::If": [
          m.conditionName,
          resolveValue(m.trueValue),
          resolveValue(m.falseValue),
        ],
      };
    case "findInMapRef":
      return {
        "Fn::FindInMap": [
          m.mappingName,
          resolveValue(m.firstKey),
          resolveValue(m.secondKey),
        ],
      };
    default:
      return marker;
  }
}

function resolveResourceRef(
  resource: { __type: string; logicalId: string },
  propertyKey?: string,
): unknown {
  if (propertyKey) {
    const strategy = resolutionMap.get(propertyKey);
    if (strategy) {
      if (strategy.method === "getAtt") {
        return { "Fn::GetAtt": [resource.logicalId, strategy.attribute] };
      }
      return { Ref: resource.logicalId };
    }
  }
  return { Ref: resource.logicalId };
}

function resolveString(value: string): unknown {
  const regex = new RegExp(TOKEN_REGEX.source, "g");

  if (!regex.test(value)) return value;
  regex.lastIndex = 0;

  const parts: unknown[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    const resolvable = tokenRegistry.get(match[1]);
    if (resolvable) {
      parts.push(resolvableToIntrinsic(resolvable));
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  if (parts.length === 1 && typeof parts[0] !== "string") return parts[0];
  return { "Fn::Join": ["", parts] };
}

function resolvableToIntrinsic(r: Resolvable): unknown {
  switch (r.kind) {
    case "ref":
      return { Ref: r.logicalId };
    case "getAtt":
      return { "Fn::GetAtt": [r.logicalId, r.attribute] };
    case "sub":
      return { "Fn::Sub": r.template };
    case "join":
      return { "Fn::Join": [r.delimiter, r.parts.map((p) => resolveValue(p))] };
    case "select":
      return { "Fn::Select": [r.index, resolveValue(r.list)] };
  }
}

export function resetTokens(): void {
  tokenCounter = 0;
  tokenRegistry.clear();
}
