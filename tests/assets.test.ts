import { describe, it, expect, beforeEach } from "vitest";
import { resetTokens } from "../src/runtime/tokens";
import { resetRegistry } from "../src/runtime/registry";
import { resetAssets, mkAsset, mkDockerAsset, getAssetManifest } from "../src/runtime/assets";
import { synth } from "../src/runtime/synth";
import { mkFunction } from "../src/lib/lambda";
import { mkRole } from "../src/generated/iam";

function reset() {
  resetTokens();
  resetRegistry();
  resetAssets();
}

describe("assets", () => {
  beforeEach(reset);

  it("creates an S3 asset with token references", () => {
    const asset = mkAsset("HandlerCode", {
      type: "bundle",
      path: "./src/handler",
      bundler: { runtime: "nodejs20.x", command: "esbuild" },
    });

    expect(asset.__kind).toBe("asset");
    expect(asset.id).toBe("HandlerCode");
    expect(typeof asset.s3Bucket).toBe("string");
    expect(typeof asset.s3Key).toBe("string");
    expect(typeof asset.s3Url).toBe("string");
  });

  it("creates a Docker asset with imageUri token", () => {
    const image = mkDockerAsset("ApiImage", "./services/api", {
      buildArgs: { NODE_ENV: "production" },
    });

    expect(image.__kind).toBe("dockerAsset");
    expect(image.id).toBe("ApiImage");
    expect(typeof image.imageUri).toBe("string");
    expect(image.source.buildArgs).toEqual({ NODE_ENV: "production" });
  });

  it("asset tokens can be used in resource properties and synth succeeds", () => {
    const asset = mkAsset("Code", { type: "directory", path: "./dist" });
    const role = mkRole("Role", { assumeRolePolicyDocument: {} });
    mkFunction("Fn", {
      runtime: "nodejs20.x",
      handler: "index.handler",
      code: { s3Bucket: asset.s3Bucket, s3Key: asset.s3Key },
      role,
    });

    const template = synth();

    // Asset tokens resolve to Refs (deploy tool substitutes later)
    const fnProps = template.Resources.Fn.Properties as Record<string, unknown>;
    const code = fnProps.code as Record<string, unknown>;
    expect(code.s3Bucket).toEqual({ Ref: "__asset_bucket__Code" });
    expect(code.s3Key).toEqual({ Ref: "__asset_key__Code" });

    // Manifest has the asset
    const manifest = getAssetManifest();
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]).toEqual({
      id: "Code",
      source: { type: "directory", path: "./dist" },
      destination: { type: "s3" },
    });
  });

  it("builds an asset manifest with multiple assets", () => {
    mkAsset("Frontend", { type: "directory", path: "./build" });
    mkAsset("Backend", {
      type: "bundle",
      path: "./src/api",
      bundler: { runtime: "nodejs20.x" },
    });
    mkDockerAsset("Worker", "./services/worker");

    const manifest = getAssetManifest();

    expect(manifest.assets).toHaveLength(3);
    expect(manifest.assets[0].id).toBe("Frontend");
    expect(manifest.assets[0].destination.type).toBe("s3");
    expect(manifest.assets[1].id).toBe("Backend");
    expect(manifest.assets[2].id).toBe("Worker");
    expect(manifest.assets[2].destination.type).toBe("ecr");
  });
});
