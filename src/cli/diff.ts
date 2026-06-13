import { Template } from "../runtime/synth.js";

export type DiffEntry = {
  type: "added" | "removed" | "modified";
  logicalId: string;
  resourceType?: string;
  details?: string;
};

export function diffTemplates(previous: Template | null, current: Template): DiffEntry[] {
  const entries: DiffEntry[] = [];

  const prevResources = previous?.Resources ?? {};
  const currResources = current.Resources;

  const prevIds = new Set(Object.keys(prevResources));
  const currIds = new Set(Object.keys(currResources));

  // Added
  for (const id of currIds) {
    if (!prevIds.has(id)) {
      entries.push({
        type: "added",
        logicalId: id,
        resourceType: currResources[id].Type,
      });
    }
  }

  // Removed
  for (const id of prevIds) {
    if (!currIds.has(id)) {
      entries.push({
        type: "removed",
        logicalId: id,
        resourceType: prevResources[id].Type,
      });
    }
  }

  // Modified
  for (const id of currIds) {
    if (!prevIds.has(id)) continue;
    const prev = prevResources[id];
    const curr = currResources[id];

    if (JSON.stringify(prev) !== JSON.stringify(curr)) {
      const changes: string[] = [];
      if (prev.Type !== curr.Type) {
        changes.push(`type: ${prev.Type} → ${curr.Type}`);
      }
      if (JSON.stringify(prev.Properties) !== JSON.stringify(curr.Properties)) {
        changes.push("properties changed");
      }
      if (JSON.stringify(prev.DependsOn) !== JSON.stringify(curr.DependsOn)) {
        changes.push("dependencies changed");
      }
      entries.push({
        type: "modified",
        logicalId: id,
        resourceType: curr.Type,
        details: changes.join(", "),
      });
    }
  }

  return entries;
}

export function formatDiff(entries: DiffEntry[]): string {
  if (entries.length === 0) return "No changes.";

  const lines: string[] = [];
  const added = entries.filter((e) => e.type === "added");
  const removed = entries.filter((e) => e.type === "removed");
  const modified = entries.filter((e) => e.type === "modified");

  if (added.length > 0) {
    lines.push(`  + ${added.length} resource(s) to add:`);
    for (const e of added) {
      lines.push(`    + ${e.logicalId} (${e.resourceType})`);
    }
  }

  if (removed.length > 0) {
    lines.push(`  - ${removed.length} resource(s) to remove:`);
    for (const e of removed) {
      lines.push(`    - ${e.logicalId} (${e.resourceType})`);
    }
  }

  if (modified.length > 0) {
    lines.push(`  ~ ${modified.length} resource(s) to modify:`);
    for (const e of modified) {
      lines.push(`    ~ ${e.logicalId} (${e.resourceType}): ${e.details}`);
    }
  }

  return lines.join("\n");
}
