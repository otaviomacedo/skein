#!/usr/bin/env node

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { writeSingleTemplate, writeAssembly, readAssemblyManifest, readTemplate, AssemblyConfig } from "./assembly.js";
import { diffTemplates, formatDiff } from "./diff.js";
import { deploy } from "./deploy.js";
import { synth, synthMulti } from "../runtime/synth.js";
import { getAssetManifest } from "../runtime/assets.js";
import { getStackAssignments } from "../runtime/stacks.js";
import { buildGraph } from "../runtime/graph.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_OUT_DIR = ".cloud-assembly";
const DEFAULT_ENTRY = "skein.app.ts";

function usage() {
  console.log(`
skein - IaC framework based on monoidal composition

Usage:
  skein synth  [--entry <file>] [--out <dir>]
  skein diff   [--entry <file>] [--out <dir>]
  skein deploy [--entry <file>] [--out <dir>] [--qualifier <q>] [--region <r>]

Commands:
  synth   Run the app and produce a cloud assembly
  diff    Synth and show what changed vs. the last assembly
  deploy  Synth, build assets, upload, and deploy stacks via CloudFormation

Options:
  --entry <file>        Entrypoint file (default: ${DEFAULT_ENTRY})
  --out <dir>           Output directory (default: ${DEFAULT_OUT_DIR})
  --qualifier <qual>    CDK bootstrap qualifier (default: hnb659fds)
  --region <region>     AWS region

Deploy uses the CDK bootstrap stack resources (S3 bucket, ECR repo, IAM roles)
identified by the qualifier. Run 'cdk bootstrap' first if not already done.
`);
}

type ParsedArgs = {
  command: string;
  entry: string;
  outDir: string;
  qualifier?: string;
  region?: string;
};

function parseArgs(args: string[]): ParsedArgs {
  const command = args[0] ?? "";
  let entry = DEFAULT_ENTRY;
  let outDir = DEFAULT_OUT_DIR;
  let qualifier: string | undefined;
  let region: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--entry" && args[i + 1]) {
      entry = args[++i];
    } else if (args[i] === "--out" && args[i + 1]) {
      outDir = args[++i];
    } else if (args[i] === "--qualifier" && args[i + 1]) {
      qualifier = args[++i];
    } else if (args[i] === "--region" && args[i + 1]) {
      region = args[++i];
    }
  }

  return { command, entry: resolve(entry), outDir: resolve(outDir), qualifier, region };
}

async function loadApp(entryPath: string): Promise<void> {
  if (!existsSync(entryPath)) {
    console.error(`Error: entry file not found: ${entryPath}`);
    process.exit(1);
  }
  await import(entryPath);
}

function writeCloudAssembly(outDir: string): void {
  const config: AssemblyConfig = { outDir };
  const assetManifest = getAssetManifest();
  const stackAssignments = getStackAssignments();

  if (stackAssignments.size > 0) {
    const output = synthMulti();
    writeAssembly(output, assetManifest, config);
  } else {
    const template = synth();
    writeSingleTemplate(template, assetManifest, config);
  }

  const graph = buildGraph();
  writeFileSync(join(outDir, "graph.json"), JSON.stringify(graph, null, 2));
}

async function commandSynth(entry: string, outDir: string) {
  await loadApp(entry);
  writeCloudAssembly(outDir);
  console.log(`Cloud assembly written to ${outDir}`);
}

async function commandDiff(entry: string, outDir: string) {
  // Read previous assembly
  const prevManifest = readAssemblyManifest(outDir);
  const prevTemplates = new Map<string, ReturnType<typeof readTemplate>>();
  if (prevManifest) {
    for (const [stackName, stackDef] of Object.entries(prevManifest.stacks)) {
      prevTemplates.set(stackName, readTemplate(outDir, stackDef.template));
    }
  }

  // Load app and write assembly
  await loadApp(entry);
  writeCloudAssembly(outDir);

  // Read new assembly
  const newManifest = readAssemblyManifest(outDir);
  if (!newManifest) {
    console.error("Error: synth did not produce a cloud assembly.");
    process.exit(1);
  }

  // Diff each stack
  let hasChanges = false;
  for (const [stackName, stackDef] of Object.entries(newManifest.stacks)) {
    const prev = prevTemplates.get(stackName) ?? null;
    const curr = readTemplate(outDir, stackDef.template);
    if (!curr) continue;

    const entries = diffTemplates(prev, curr);
    if (entries.length > 0) {
      hasChanges = true;
      console.log(`\nStack: ${stackName}`);
      console.log(formatDiff(entries));
    }
  }

  // Check for removed stacks
  if (prevManifest) {
    for (const stackName of Object.keys(prevManifest.stacks)) {
      if (!newManifest.stacks[stackName]) {
        hasChanges = true;
        console.log(`\nStack: ${stackName} (REMOVED)`);
      }
    }
  }

  if (!hasChanges) {
    console.log("\nNo changes.");
  }
}

async function commandDeploy(entry: string, outDir: string, qualifier?: string, region?: string) {
  // Resolve account/region before loading the app so setAssetEnvironment can use them
  const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
  const sts = new STSClient({ region });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const resolvedRegion = region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

  process.env.CDK_DEFAULT_ACCOUNT = identity.Account;
  process.env.CDK_DEFAULT_REGION = resolvedRegion;

  await loadApp(entry);
  writeCloudAssembly(outDir);

  await deploy({ outDir, qualifier, region: resolvedRegion });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage();
    process.exit(0);
  }

  const { command, entry, outDir, qualifier, region } = parseArgs(args);

  switch (command) {
    case "synth":
      await commandSynth(entry, outDir);
      break;
    case "diff":
      await commandDiff(entry, outDir);
      break;
    case "deploy":
      await commandDeploy(entry, outDir, qualifier, region);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
