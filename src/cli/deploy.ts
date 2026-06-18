import {
  CloudFormationClient,
  CreateStackCommand,
  UpdateStackCommand,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  type StackEvent,
} from "@aws-sdk/client-cloudformation";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { AssemblyManifest } from "./assembly.js";
import { AssetManifestEntry } from "../runtime/assets.js";

const DEFAULT_QUALIFIER = "hnb659fds";

export type DeployConfig = {
  outDir: string;
  region?: string;
  qualifier?: string;
};

type BootstrapContext = {
  account: string;
  region: string;
  qualifier: string;
  bucket: string;
  ecrRepo: string;
  deployRoleArn: string;
  cfnExecRoleArn: string;
  filePublishingRoleArn: string;
  imagePublishingRoleArn: string;
};

type StackStatus = string;

export async function deploy(config: DeployConfig): Promise<void> {
  const { outDir, qualifier = DEFAULT_QUALIFIER } = config;

  const manifest = readManifest(outDir);
  if (!manifest) {
    throw new Error(`No manifest.json found in ${outDir}. Run 'skein synth' first.`);
  }

  // Discover account and region
  const sts = new STSClient({ region: config.region });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  const account = identity.Account!;
  const region = config.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

  const ctx: BootstrapContext = {
    account,
    region,
    qualifier,
    bucket: `cdk-${qualifier}-assets-${account}-${region}`,
    ecrRepo: `cdk-${qualifier}-container-assets-${account}-${region}`,
    deployRoleArn: `arn:aws:iam::${account}:role/cdk-${qualifier}-deploy-role-${account}-${region}`,
    cfnExecRoleArn: `arn:aws:iam::${account}:role/cdk-${qualifier}-cfn-exec-role-${account}-${region}`,
    filePublishingRoleArn: `arn:aws:iam::${account}:role/cdk-${qualifier}-file-publishing-role-${account}-${region}`,
    imagePublishingRoleArn: `arn:aws:iam::${account}:role/cdk-${qualifier}-image-publishing-role-${account}-${region}`,
  };

  console.log(`\nAccount:   ${account}`);
  console.log(`Region:    ${region}`);
  console.log(`Qualifier: ${qualifier}`);
  console.log(`Bucket:    ${ctx.bucket}`);

  // 1. Build and publish assets
  const fileAssets = manifest.assets.assets.filter(a => a.source.type !== "docker");
  const dockerAssets = manifest.assets.assets.filter(a => a.source.type === "docker");

  if (fileAssets.length > 0) {
    console.log(`\nUploading ${fileAssets.length} file asset(s)...`);
    const s3Creds = await assumeRole(sts, ctx.filePublishingRoleArn, "skein-file-publish");
    const s3 = new S3Client({ region, credentials: s3Creds });
    await uploadAssets(fileAssets, s3, ctx.bucket, outDir);
  }

  if (dockerAssets.length > 0) {
    console.log(`\nBuilding and pushing ${dockerAssets.length} Docker image(s)...`);
    const imgCreds = await assumeRole(sts, ctx.imagePublishingRoleArn, "skein-image-publish");
    await buildAndPushImages(dockerAssets, ctx, imgCreds, outDir);
  }

  // 2. Assume deploy role and deploy stacks
  // Templates already have literal asset locations (resolved at synth time)
  const deployCreds = await assumeRole(sts, ctx.deployRoleArn, "skein-deploy");
  const cfn = new CloudFormationClient({ region, credentials: deployCreds });

  const order = topologicalSort(manifest.stacks);
  console.log(`\nDeploying ${order.length} stack(s): ${order.join(" → ")}`);

  for (const stackName of order) {
    const stackDef = manifest.stacks[stackName];
    const templatePath = join(outDir, stackDef.template);
    const templateBody = readFileSync(templatePath, "utf-8");

    await deployStack(cfn, stackName, templateBody, ctx.cfnExecRoleArn);
  }

  console.log("\n✓ Deploy complete.");
}

// === Role assumption ===

type Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

async function assumeRole(
  sts: STSClient,
  roleArn: string,
  sessionName: string,
): Promise<Credentials> {
  const result = await sts.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: sessionName,
  }));

  const creds = result.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error(`Failed to assume role: ${roleArn}`);
  }

  return {
    accessKeyId: creds.AccessKeyId,
    secretAccessKey: creds.SecretAccessKey,
    sessionToken: creds.SessionToken,
  };
}

// === Docker asset handling ===

async function buildAndPushImages(
  assets: AssetManifestEntry[],
  ctx: BootstrapContext,
  creds: Credentials,
  outDir: string,
): Promise<void> {
  const ecrEndpoint = `${ctx.account}.dkr.ecr.${ctx.region}.amazonaws.com`;
  const repo = `${ecrEndpoint}/${ctx.ecrRepo}`;

  execSync(
    `aws ecr get-login-password --region ${ctx.region} | docker login --username AWS --password-stdin ${ecrEndpoint}`,
    {
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: creds.accessKeyId,
        AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
        AWS_SESSION_TOKEN: creds.sessionToken,
        AWS_REGION: ctx.region,
      },
      stdio: "pipe",
    },
  );

  for (const asset of assets) {
    const source = asset.source as { type: "docker"; path: string; file?: string; buildArgs?: Record<string, string> };
    const contextPath = resolve(source.path);
    const dockerfile = source.file ?? "Dockerfile";
    const tag = `${repo}:${asset.destination.imageTag}`;

    if (imageExists(ecrEndpoint, ctx.ecrRepo, asset.destination.imageTag!, creds, ctx.region)) {
      console.log(`  ✓ ${asset.id} (already pushed)`);
      continue;
    }

    let buildCmd = `docker build -t "${tag}" -f "${join(contextPath, dockerfile)}" "${contextPath}"`;
    if (source.buildArgs) {
      for (const [k, v] of Object.entries(source.buildArgs)) {
        buildCmd += ` --build-arg ${k}=${v}`;
      }
    }

    console.log(`  🔨 ${asset.id}: building...`);
    execSync(buildCmd, { stdio: "pipe", env: { ...process.env, DOCKER_DEFAULT_PLATFORM: "linux/amd64" } });

    console.log(`  ↑ ${asset.id} → ${tag}`);
    execSync(`docker push "${tag}"`, { stdio: "pipe" });
  }
}

function imageExists(
  ecrEndpoint: string,
  repository: string,
  imageTag: string,
  creds: Credentials,
  region: string,
): boolean {
  try {
    execSync(
      `aws ecr describe-images --repository-name "${repository}" --image-ids imageTag="${imageTag}" --region ${region}`,
      {
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: creds.accessKeyId,
          AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
          AWS_SESSION_TOKEN: creds.sessionToken,
          AWS_REGION: region,
        },
        stdio: "pipe",
      },
    );
    return true;
  } catch {
    return false;
  }
}

// === File asset handling ===

async function uploadAssets(
  assets: AssetManifestEntry[],
  s3: S3Client,
  bucket: string,
  outDir: string,
): Promise<void> {
  for (const asset of assets) {
    const key = `${asset.id}/${asset.hash}.zip`;

    if (await objectExists(s3, bucket, key)) {
      console.log(`  ✓ ${asset.id} (already uploaded)`);
      continue;
    }

    const built = buildAsset(asset, outDir);
    console.log(`  ↑ ${asset.id} → s3://${bucket}/${key}`);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: built.content,
    }));
  }
}

async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

type BuiltAsset = {
  content: Buffer;
  extension: string;
};

function buildAsset(entry: AssetManifestEntry, outDir: string): BuiltAsset {
  const source = entry.source;

  switch (source.type) {
    case "file": {
      const filePath = resolve(source.path);
      const ext = extOf(filePath);

      // TypeScript/JavaScript files: bundle with esbuild and zip
      if (ext === ".ts" || ext === ".js" || ext === ".mts" || ext === ".mjs") {
        const bundleDir = join(outDir, `${entry.id}-bundle`);
        const outFile = join(bundleDir, "index.js");
        execSync(`mkdir -p "${bundleDir}"`);
        execSync(`npx esbuild "${filePath}" --bundle --platform=node --target=node20 --outfile="${outFile}" --format=cjs --external:@aws-sdk/*`);
        const zipPath = join(outDir, `${entry.id}.zip`);
        execSync(`cd "${bundleDir}" && zip -qr "${resolve(zipPath)}" .`);
        const content = readFileSync(zipPath);
        return { content, extension: ".zip" };
      }

      // Other files: upload as-is
      const content = readFileSync(filePath);
      return { content, extension: ext };
    }
    case "directory": {
      const zipPath = join(outDir, `${entry.id}.zip`);
      execSync(`cd "${resolve(source.path)}" && zip -qr "${resolve(zipPath)}" .`);
      const content = readFileSync(zipPath);
      return { content, extension: ".zip" };
    }
    case "bundle": {
      const zipPath = join(outDir, `${entry.id}.zip`);
      const srcPath = resolve(source.path);
      if (source.bundler?.command) {
        execSync(source.bundler.command, { cwd: srcPath });
      }
      execSync(`cd "${srcPath}" && zip -qr "${resolve(zipPath)}" .`);
      const content = readFileSync(zipPath);
      return { content, extension: ".zip" };
    }
    case "docker":
      throw new Error("Unreachable: docker assets filtered before buildAsset");
  }
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot) : "";
}

// === Stack deployment ===

async function deployStack(
  cfn: CloudFormationClient,
  stackName: string,
  templateBody: string,
  cfnExecRoleArn: string,
): Promise<void> {
  const existing = await getStackStatus(cfn, stackName);

  console.log(`\n  Stack: ${stackName}`);

  if (!existing) {
    console.log("  Creating...");
    await cfn.send(new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      RoleARN: cfnExecRoleArn,
      Capabilities: ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"],
    }));
  } else if (existing === "ROLLBACK_COMPLETE") {
    throw new Error(
      `Stack ${stackName} is in ROLLBACK_COMPLETE state. Delete it manually before redeploying.`,
    );
  } else {
    console.log("  Updating...");
    try {
      await cfn.send(new UpdateStackCommand({
        StackName: stackName,
        TemplateBody: templateBody,
        RoleARN: cfnExecRoleArn,
        Capabilities: ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"],
      }));
    } catch (err: any) {
      if (err.message?.includes("No updates are to be performed")) {
        console.log("  (no changes)");
        return;
      }
      throw err;
    }
  }

  await waitForStack(cfn, stackName);
}

async function getStackStatus(
  cfn: CloudFormationClient,
  stackName: string,
): Promise<StackStatus | null> {
  try {
    const result = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = result.Stacks?.[0];
    if (!stack || stack.StackStatus === "DELETE_COMPLETE") return null;
    return stack.StackStatus ?? null;
  } catch (err: any) {
    if (err.message?.includes("does not exist")) return null;
    throw err;
  }
}

async function waitForStack(
  cfn: CloudFormationClient,
  stackName: string,
): Promise<void> {
  const seen = new Set<string>();
  const startTime = Date.now();

  while (true) {
    await sleep(3000);

    const events = await getNewEvents(cfn, stackName, seen);
    for (const event of events) {
      printEvent(event);
    }

    const status = await getStackStatus(cfn, stackName);
    if (!status) throw new Error(`Stack ${stackName} disappeared during deployment.`);

    if (status.endsWith("_COMPLETE") || status.endsWith("_FAILED")) {
      if (status.includes("ROLLBACK") || status.includes("FAILED")) {
        throw new Error(`Stack ${stackName} failed: ${status}`);
      }
      return;
    }

    if (Date.now() - startTime > 30 * 60 * 1000) {
      throw new Error(`Stack ${stackName} timed out after 30 minutes.`);
    }
  }
}

async function getNewEvents(
  cfn: CloudFormationClient,
  stackName: string,
  seen: Set<string>,
): Promise<StackEvent[]> {
  const result = await cfn.send(new DescribeStackEventsCommand({ StackName: stackName }));
  const events = result.StackEvents ?? [];
  const newEvents: StackEvent[] = [];

  for (const event of events) {
    const id = event.EventId ?? "";
    if (seen.has(id)) break;
    seen.add(id);
    newEvents.push(event);
  }

  return newEvents.reverse();
}

function printEvent(event: StackEvent): void {
  const status = event.ResourceStatus ?? "";
  const id = event.LogicalResourceId ?? "";
  const reason = event.ResourceStatusReason ? ` (${event.ResourceStatusReason})` : "";

  const color = status.includes("FAILED") || status.includes("ROLLBACK")
    ? "\x1b[31m" : status.includes("COMPLETE") ? "\x1b[32m" : "\x1b[33m";
  const reset = "\x1b[0m";

  console.log(`  ${color}${status.padEnd(30)}${reset} ${id}${reason}`);
}

// === Utilities ===

function topologicalSort(
  stacks: Record<string, { template: string; dependencies: string[] }>,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const deps = stacks[name]?.dependencies ?? [];
    for (const dep of deps) visit(dep);
    result.push(name);
  }

  for (const name of Object.keys(stacks)) visit(name);
  return result;
}

function readManifest(outDir: string): AssemblyManifest | null {
  const path = join(outDir, "manifest.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}