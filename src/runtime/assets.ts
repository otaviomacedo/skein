import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export type AssetSource =
  | { type: "file"; path: string }
  | { type: "directory"; path: string; exclude?: string[] }
  | { type: "bundle"; path: string; bundler: BundlerConfig }
  | { type: "docker"; path: string; buildArgs?: Record<string, string>; file?: string };

export type BundlerConfig = {
  runtime?: string;
  command?: string;
  entrypoint?: string;
};

export type Asset = {
  readonly __kind: "asset";
  readonly id: string;
  readonly source: AssetSource;
  readonly s3Bucket: string;
  readonly s3Key: string;
  readonly s3Url: string;
};

export type DockerAsset = {
  readonly __kind: "dockerAsset";
  readonly id: string;
  readonly source: AssetSource & { type: "docker" };
  readonly imageUri: string;
};

export type AssetManifestEntry = {
  id: string;
  source: AssetSource;
  hash: string;
  destination: {
    type: "s3" | "ecr";
    bucket?: string;
    prefix?: string;
    repository?: string;
    imageTag?: string;
  };
};

export type AssetManifest = {
  assets: AssetManifestEntry[];
};

// === Environment configuration ===

export type AssetEnvironment = {
  account: string;
  region: string;
  qualifier?: string;
};

const DEFAULT_QUALIFIER = "hnb659fds";
let assetEnv: AssetEnvironment | null = null;

export function setAssetEnvironment(env: AssetEnvironment): void {
  assetEnv = env;
}

export function getAssetEnvironment(): AssetEnvironment | null {
  return assetEnv;
}

function requireEnv(): AssetEnvironment {
  if (!assetEnv) {
    throw new Error(
      "Asset environment not set. Call setAssetEnvironment({ account, region }) before creating assets.",
    );
  }
  return assetEnv;
}

function bucketName(env: AssetEnvironment): string {
  const q = env.qualifier ?? DEFAULT_QUALIFIER;
  return `cdk-${q}-assets-${env.account}-${env.region}`;
}

function ecrRepo(env: AssetEnvironment): string {
  const q = env.qualifier ?? DEFAULT_QUALIFIER;
  return `cdk-${q}-container-assets-${env.account}-${env.region}`;
}

function ecrUri(env: AssetEnvironment, tag: string): string {
  return `${env.account}.dkr.ecr.${env.region}.amazonaws.com/${ecrRepo(env)}:${tag}`;
}

// === Asset registry ===

const assets: AssetManifestEntry[] = [];

export function mkAsset(id: string, source: Exclude<AssetSource, { type: "docker" }>): Asset {
  const env = requireEnv();
  const hash = hashSource(source);
  const bucket = bucketName(env);
  const key = `${id}/${hash}.zip`;

  const entry: AssetManifestEntry = {
    id,
    source,
    hash,
    destination: { type: "s3", bucket, prefix: id },
  };
  assets.push(entry);

  return {
    __kind: "asset",
    id,
    source,
    s3Bucket: bucket,
    s3Key: key,
    s3Url: `https://${bucket}.s3.amazonaws.com/${key}`,
  };
}

export function mkDockerAsset(
  id: string,
  path: string,
  opts?: { buildArgs?: Record<string, string>; file?: string },
): DockerAsset {
  const env = requireEnv();
  const source: AssetSource & { type: "docker" } = {
    type: "docker",
    path,
    buildArgs: opts?.buildArgs,
    file: opts?.file,
  };
  const hash = hashSource(source);
  const tag = `${id}-${hash}`;

  const entry: AssetManifestEntry = {
    id,
    source,
    hash,
    destination: { type: "ecr", repository: ecrRepo(env), imageTag: tag },
  };
  assets.push(entry);

  return {
    __kind: "dockerAsset",
    id,
    source,
    imageUri: ecrUri(env, tag),
  };
}

export function getAssetManifest(): AssetManifest {
  return { assets: [...assets] };
}

export function resetAssets(): void {
  assets.length = 0;
  assetEnv = null;
}

// === Hashing ===

function hashSource(source: AssetSource): string {
  switch (source.type) {
    case "file":
      return hashFile(source.path);
    case "directory":
      return hashDirectory(source.path, source.exclude);
    case "bundle":
      return hashDirectory(source.path);
    case "docker":
      return hashDirectory(source.path);
  }
}

function hashFile(path: string): string {
  if (!existsSync(path)) return hashString(path);
  const content = readFileSync(path);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function hashDirectory(dirPath: string, exclude?: string[]): string {
  const hash = createHash("sha256");
  if (!existsSync(dirPath)) {
    hash.update(dirPath);
    return hash.digest("hex").slice(0, 16);
  }
  const excludeSet = new Set(exclude ?? []);
  walkDir(dirPath, excludeSet, (filePath) => {
    hash.update(filePath);
    hash.update(readFileSync(filePath));
  });
  return hash.digest("hex").slice(0, 16);
}

function walkDir(dir: string, exclude: Set<string>, visitor: (path: string) => void): void {
  const entries = readdirSync(dir).sort();
  for (const entry of entries) {
    if (exclude.has(entry)) continue;
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkDir(full, exclude, visitor);
    } else {
      visitor(full);
    }
  }
}

function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
