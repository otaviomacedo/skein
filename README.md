# Skein

An Infrastructure-as-Code framework where resources flow on typed wires through composable boxes, producing CloudFormation templates. Inspired by monoidal categories and wiring diagrams (Fong & Spivak, *Seven Sketches in Compositionality*, Chapter 4).

## Why

CDK models infrastructure as a mutable construct tree. Reorganizing the tree changes logical IDs, `grant*` methods mutate via side effects, and resources hide inside constructs. Skein replaces this with flat composition of pure functions:

| CDK                                                 | Skein                                             |
|-----------------------------------------------------|---------------------------------------------------|
| Construct tree, implicit resource creation          | Flat composition, explicit resource flow          |
| Logical IDs from tree path (refactoring breaks IDs) | IDs explicit or derived from dependencies         |
| `grant*` mutates constructs via side effects        | `grant*` returns new values + auxiliary resources |
| Resources hidden inside constructs                  | Every resource visible on a wire                  |
| Scope determines ownership                          | Boxes are context-free                            |

## Core Concepts

**Boxes** are pure functions with typed inputs and outputs. Three kinds:

- **Generators** create resources from nothing: `I → Resource`
- **Transformers** modify a resource in place: `A → A`
- **Wirers** connect resources and emit auxiliaries: `A ⊗ B → A ⊗ B ⊗ C`

Boxes compose sequentially (function application) and in parallel (monoidal product). A composition of boxes is itself a box.

**Registry** — every resource returned by a box is captured in a global registry, ensuring it ends up in the final template even if the caller ignores it.

**Tokens** — property values referencing other resources are opaque strings that resolve to CloudFormation intrinsics (`Ref`, `Fn::GetAtt`, `Fn::Join`) at synth time. String interpolation works naturally.

**Merge semantics** — when parallel boxes modify the same resource, patches merge at synth time (deep object merge, conflict detection on scalars).

## Quick Start

```bash
yarn install
yarn build
```

### Define infrastructure

```typescript
import { mkBucket, mkRole, mkFunction } from "skein";
import { encrypt, enableVersioning } from "skein/boxes/s3";
import { grantRead } from "skein/boxes/iam";
import { pipe } from "skein/boxes/pipe";

// Generators — explicit logical IDs
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

// Composition — pipe through transformers
const bucket2 = pipe(bucket).to(enableVersioning).to(encrypt).done();

// Wiring — grantRead creates an auxiliary Policy resource
pipe(fn).to(grantRead, bucket2).done();
```

### Synth and deploy

```bash
skein synth    # writes .cloud-assembly/
skein deploy   # builds assets, uploads, submits to CloudFormation
```

## Project Structure

```
src/
├── runtime/       # Core engine: registry, tokens, merge, synth, conditions, etc.
├── lib/           # User-facing re-exports with typed references
├── boxes/         # Reusable composition boxes (granting, VPC, Fargate, Step Functions, …)
├── generated/     # Auto-generated from CloudFormation resource spec
├── cli/           # CLI commands (synth, deploy, diff)
├── compat/        # Backwards-compatibility checking
├── testing/       # Test utilities
└── app.ts         # Public API entry point

studio/            # Visual editor (React Flow) — reads graph.json from cloud assembly
codegen/           # Code generation from CloudFormation spec
examples/          # Example apps: simple, static-site, api-backend, data-pipeline, ecommerce
```

## Cloud Assembly

The output of `skein synth` — a directory consumed by the deploy tool:

```
.cloud-assembly/
├── manifest.json       # stacks, dependencies, asset references
├── graph.json          # wiring diagram IR (for studio)
├── stacks/
│   └── *.template.json
└── config.json         # staging bucket, region, account
```

## Visual Editor

```bash
yarn studio
```

Skein Studio reads `graph.json` and renders the wiring diagram. Supports zoom into composite boxes, code generation from graph, and round-trip editing (code → synth → graph → GUI → regenerate code).

## Testing

```bash
yarn test              # unit tests
yarn test:compat       # backwards-compatibility property tests
yarn test:integration  # integration tests
```

Uses Vitest for unit/integration tests and fast-check for property-based compatibility checking.

## Examples

| Example         | Description                                                                               |
|-----------------|-------------------------------------------------------------------------------------------|
| `simple`        | Bucket + Lambda with encryption and read grant                                            |
| `static-site`   | S3 + CloudFront static website                                                            |
| `api-backend`   | API Gateway + Lambda + DynamoDB                                                           |
| `data-pipeline` | Event-driven data processing pipeline                                                     |
| `ecommerce`     | Full order processing platform: VPC, Fargate, Step Functions, SNS fan-out, DLQ monitoring |

## License

ISC