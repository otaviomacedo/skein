/**
 * Backwards compatibility tests for all built-in boxes.
 *
 * Runs only on explicit request:
 *   npm run test:compat
 *
 * Compares current boxes against the latest vX.Y.Z git tag.
 * Uses property-based testing (fast-check) to generate random inputs.
 *
 * NOTE: For proper baseline comparison, both versions must be loadable in
 * the same process. This works because the baseline worktree shares
 * node_modules with the main tree (via git worktree), and boxes only import
 * from relative paths within the project.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { extractSchemas } from "../src/compat/extract-schema.js";
import { checkCompatProperty } from "../src/compat/index.js";
import type { BoxSchema } from "../src/compat/index.js";

const BOXES_DIR = resolve("src/boxes");

function findBaseline(): string | null {
  try {
    const tags = execSync("git tag --list 'v*' --sort=-v:refname", { encoding: "utf-8" })
      .trim()
      .split("\n")
      .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
    return tags[0] ?? null;
  } catch {
    return null;
  }
}

const baseline = findBaseline();
let baselineDir: string | null = null;

beforeAll(() => {
  if (!baseline) return;
  baselineDir = `/tmp/skein-compat-${baseline}-${process.pid}`;
  try {
    execSync(`git worktree add --detach "${baselineDir}" "${baseline}"`, { stdio: "pipe" });
    // Symlink node_modules and generated sources so baseline can resolve imports
    if (!existsSync(join(baselineDir, "node_modules"))) {
      execSync(`ln -s "${resolve("node_modules")}" "${join(baselineDir, "node_modules")}"`, { stdio: "pipe" });
    }
    if (!existsSync(join(baselineDir, "src/generated"))) {
      execSync(`ln -s "${resolve("src/generated")}" "${join(baselineDir, "src/generated")}"`, { stdio: "pipe" });
    }
  } catch (e: any) {
    console.error(`Failed to create worktree: ${e.message}`);
    baselineDir = null;
  }
});

afterAll(() => {
  if (baselineDir) {
    try {
      execSync(`git worktree remove "${baselineDir}" --force`, { stdio: "pipe" });
    } catch {
      // best effort
    }
  }
});

/**
 * Detect boxes that have changed between baseline and current by comparing file content.
 */
function hasFileChanged(file: string): boolean {
  if (!baselineDir) return false;
  const baselinePath = join(baselineDir, "src/boxes", file);
  const currentPath = join(BOXES_DIR, file);
  if (!existsSync(baselinePath)) return true; // new file
  const baselineContent = readFileSync(baselinePath, "utf-8");
  const currentContent = readFileSync(currentPath, "utf-8");
  return baselineContent !== currentContent;
}

describe.skipIf(!baseline)(`Box compatibility vs ${baseline}`, () => {
  const boxFiles = readdirSync(BOXES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"));

  for (const file of boxFiles) {
    const currentPath = join(BOXES_DIR, file);

    let schemas: { boxName: string; schema: BoxSchema }[];
    try {
      schemas = extractSchemas(currentPath);
    } catch {
      continue;
    }

    for (const { boxName, schema } of schemas) {
      it(`${boxName} (${file})`, async () => {
        if (!baselineDir) return;
        if (!hasFileChanged(file)) return; // unchanged — skip

        const baselinePath = join(baselineDir, "src/boxes", file);
        if (!existsSync(baselinePath)) return; // new box — nothing to compare

        // Load both versions (different absolute paths → different modules)
        let currentBox: ((...args: any[]) => any) | undefined;
        let baselineBox: ((...args: any[]) => any) | undefined;

        try {
          const mod = await import(currentPath);
          currentBox = mod[boxName];
        } catch {
          return;
        }

        try {
          const mod = await import(baselinePath);
          baselineBox = mod[boxName];
        } catch {
          return;
        }

        if (!currentBox || !baselineBox) return;

        const result = checkCompatProperty(baselineBox, currentBox, schema, { numRuns: 30 });

        if (result.level === "breaking") {
          expect.fail(
            `${boxName} has a BREAKING change vs ${baseline}:\n` +
            `  Removed: ${result.removedResources.join(", ") || "none"}\n` +
            `  Diffs: ${result.diffs.map((d) => d.logicalId + ": " + d.kind).join(", ")}\n` +
            (result.counterexample ? `  Counterexample: ${JSON.stringify(result.counterexample).slice(0, 200)}` : ""),
          );
        }
      });
    }
  }
});
