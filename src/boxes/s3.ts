import type { Bucket } from "../generated/s3.js";
import { updateResource } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export const encrypt = box("encrypt", (bucket: Bucket, algorithm: string = "AES256"): Bucket => {
  const properties = {
    ...bucket.properties,
    bucketEncryption: {
      serverSideEncryptionConfiguration: [{
        serverSideEncryptionByDefault: { sseAlgorithm: algorithm },
      }],
    },
  };
  updateResource(bucket.logicalId, bucket.__type, properties);
  return { ...bucket, properties };
});

export const enableVersioning = box("enableVersioning", (bucket: Bucket): Bucket => {
  const properties = {
    ...bucket.properties,
    versioningConfiguration: { status: "Enabled" },
  };
  updateResource(bucket.logicalId, bucket.__type, properties);
  return { ...bucket, properties };
});

export const enableWebHosting = box(
  "enableWebHosting",
  (bucket: Bucket, indexDoc: string = "index.html", errorDoc: string = "error.html"): Bucket => {
    const properties = {
      ...bucket.properties,
      websiteConfiguration: { indexDocument: indexDoc, errorDocument: errorDoc },
    };
    updateResource(bucket.logicalId, bucket.__type, properties);
    return { ...bucket, properties };
  },
);

export const enableLogDelivery = box("enableLogDelivery", (bucket: Bucket): Bucket => {
  const properties = {
    ...bucket.properties,
    ownershipControls: {
      rules: [{ objectOwnership: "BucketOwnerPreferred" }],
    },
  };
  updateResource(bucket.logicalId, bucket.__type, properties);
  return { ...bucket, properties };
});

export const blockPublicAccess = box("blockPublicAccess", (bucket: Bucket): Bucket => {
  const properties = {
    ...bucket.properties,
    publicAccessBlockConfiguration: {
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    },
  };
  updateResource(bucket.logicalId, bucket.__type, properties);
  return { ...bucket, properties };
});
