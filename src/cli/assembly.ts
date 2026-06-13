import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Template, SynthOutput } from "../runtime/synth.js";
import { AssetManifest } from "../runtime/assets.js";

export type AssemblyManifest = {
  version: string;
  stacks: Record<string, {
    template: string;
    dependencies: string[];
  }>;
  assets: AssetManifest;
};

export type AssemblyConfig = {
  outDir: string;
  staging?: {
    bucket: string;
    prefix?: string;
  };
};

export function writeAssembly(
  output: SynthOutput,
  assetManifest: AssetManifest,
  config: AssemblyConfig,
): string {
  const outDir = config.outDir;
  const stacksDir = join(outDir, "stacks");

  mkdirSync(stacksDir, { recursive: true });

  // Write stack templates
  for (const [stackName, template] of Object.entries(output.templates)) {
    const filePath = join(stacksDir, `${stackName}.template.json`);
    writeFileSync(filePath, JSON.stringify(template, null, 2));
  }

  // Build manifest
  const manifest: AssemblyManifest = {
    version: "1.0",
    stacks: {},
    assets: assetManifest,
  };

  for (const stackName of Object.keys(output.templates)) {
    manifest.stacks[stackName] = {
      template: `stacks/${stackName}.template.json`,
      dependencies: output.stackDependencies[stackName] ?? [],
    };
  }

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Write config
  if (config.staging) {
    writeFileSync(join(outDir, "config.json"), JSON.stringify({
      staging: config.staging,
    }, null, 2));
  }

  return outDir;
}

export function writeSingleTemplate(
  template: Template,
  assetManifest: AssetManifest,
  config: AssemblyConfig,
): string {
  const outDir = config.outDir;
  const stacksDir = join(outDir, "stacks");

  mkdirSync(stacksDir, { recursive: true });

  writeFileSync(join(stacksDir, "main.template.json"), JSON.stringify(template, null, 2));

  const manifest: AssemblyManifest = {
    version: "1.0",
    stacks: {
      main: { template: "stacks/main.template.json", dependencies: [] },
    },
    assets: assetManifest,
  };

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (config.staging) {
    writeFileSync(join(outDir, "config.json"), JSON.stringify({
      staging: config.staging,
    }, null, 2));
  }

  return outDir;
}

export function readAssemblyManifest(outDir: string): AssemblyManifest | null {
  const manifestPath = join(outDir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf-8"));
}

export function readTemplate(outDir: string, templatePath: string): Template | null {
  const fullPath = join(outDir, templatePath);
  if (!existsSync(fullPath)) return null;
  return JSON.parse(readFileSync(fullPath, "utf-8"));
}
