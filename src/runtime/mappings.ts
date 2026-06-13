export type Mapping = {
  readonly __kind: "mapping";
  readonly name: string;
  readonly data: Record<string, Record<string, unknown>>;
};

export type FindInMapRef = {
  readonly __kind: "findInMapRef";
  readonly mappingName: string;
  readonly firstKey: unknown;
  readonly secondKey: unknown;
};

const mappings = new Map<string, Record<string, Record<string, unknown>>>();

export function mkMapping(name: string, data: Record<string, Record<string, unknown>>): Mapping {
  mappings.set(name, data);
  return { __kind: "mapping", name, data };
}

export function findInMap(mapping: Mapping, firstKey: unknown, secondKey: unknown): FindInMapRef {
  return { __kind: "findInMapRef", mappingName: mapping.name, firstKey, secondKey };
}

export function isFindInMapRef(value: unknown): value is FindInMapRef {
  return (
    value !== null &&
    typeof value === "object" &&
    "__kind" in (value as object) &&
    (value as FindInMapRef).__kind === "findInMapRef"
  );
}

export function getMappings(): Map<string, Record<string, Record<string, unknown>>> {
  return mappings;
}

export function resetMappings(): void {
  mappings.clear();
}
