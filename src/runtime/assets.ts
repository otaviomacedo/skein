import { mintToken } from "./tokens.js";

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
  destination: {
    type: "s3" | "ecr";
    bucket?: string;
    prefix?: string;
    repository?: string;
  };
};

export type AssetManifest = {
  assets: AssetManifestEntry[];
};

const assets: AssetManifestEntry[] = [];

export function mkAsset(id: string, source: Exclude<AssetSource, { type: "docker" }>): Asset {
  const entry: AssetManifestEntry = {
    id,
    source,
    destination: { type: "s3" },
  };
  assets.push(entry);

  return {
    __kind: "asset",
    id,
    source,
    s3Bucket: mintToken({ kind: "ref", logicalId: `__asset_bucket__${id}` }),
    s3Key: mintToken({ kind: "ref", logicalId: `__asset_key__${id}` }),
    s3Url: mintToken({ kind: "ref", logicalId: `__asset_url__${id}` }),
  };
}

export function mkDockerAsset(
  id: string,
  path: string,
  opts?: { buildArgs?: Record<string, string>; file?: string },
): DockerAsset {
  const source: AssetSource & { type: "docker" } = {
    type: "docker",
    path,
    buildArgs: opts?.buildArgs,
    file: opts?.file,
  };
  const entry: AssetManifestEntry = {
    id,
    source,
    destination: { type: "ecr" },
  };
  assets.push(entry);

  return {
    __kind: "dockerAsset",
    id,
    source,
    imageUri: mintToken({ kind: "ref", logicalId: `__asset_image__${id}` }),
  };
}

export function getAssetManifest(): AssetManifest {
  return { assets: [...assets] };
}

export function resetAssets(): void {
  assets.length = 0;
}
