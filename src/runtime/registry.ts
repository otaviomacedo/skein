export type Patch = {
  logicalId: string;
  type: string;
  properties: Record<string, unknown>;
};

const patches: Patch[] = [];
const discarded = new Set<string>();
const resourceConditions = new Map<string, string>();
const resourceMetadata = new Map<string, Record<string, unknown>>();

export function registerResource(
  logicalId: string,
  type: string,
  properties: Record<string, unknown>,
): void {
  patches.push({ logicalId, type, properties: { ...properties } });
}

export function updateResource(
  logicalId: string,
  type: string,
  properties: Record<string, unknown>,
): void {
  patches.push({ logicalId, type, properties: { ...properties } });
}

export function discard(logicalId: string): void {
  discarded.add(logicalId);
}

export function setCondition(logicalId: string, conditionName: string): void {
  resourceConditions.set(logicalId, conditionName);
}

export function setMetadata(logicalId: string, metadata: Record<string, unknown>): void {
  resourceMetadata.set(logicalId, metadata);
}

export function getPatches(): Patch[] {
  return patches;
}

export function getDiscarded(): Set<string> {
  return discarded;
}

export function getResourceConditions(): Map<string, string> {
  return resourceConditions;
}

export function getResourceMetadata(): Map<string, Record<string, unknown>> {
  return resourceMetadata;
}

export function resetRegistry(): void {
  patches.length = 0;
  discarded.clear();
  resourceConditions.clear();
  resourceMetadata.clear();
}
