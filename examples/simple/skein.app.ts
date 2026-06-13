import { mkBucket } from "../../src/generated/s3.js";
import { mkRole } from "../../src/generated/iam.js";
import { mkFunction } from "../../src/lib/lambda.js";
import { encrypt, enableVersioning } from "../../src/boxes/s3.js";
import { grantRead } from "../../src/boxes/iam.js";
import { pipe } from "../../src/boxes/pipe.js";

// Generators
const bucket = mkBucket("DataBucket", { bucketName: "my-data-bucket" });
const role = mkRole("ProcessorRole", {
  assumeRolePolicyDocument: {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  },
});
const fn = mkFunction("Processor", {
  runtime: "nodejs20.x",
  handler: "index.handler",
  code: { s3Bucket: "code-bucket", s3Key: "processor.zip" },
  role,
});

// Composition
const bucket2 = pipe(bucket).to(enableVersioning).to(encrypt).done();

pipe(fn).to(grantRead, bucket2).done();
