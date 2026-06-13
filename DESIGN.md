# Skein — Design Decisions

An IaC framework inspired by monoidal categories and wiring diagrams (Fong & Spivak, Chapter 4).
Resources flow on wires through composable boxes, producing CloudFormation templates.

## Core Principles

1. **Boxes all the way down.** The fundamental building block is a box (function) with typed inputs
   and outputs. Boxes compose sequentially and in parallel. A composition of boxes is itself a box.

2. **Functional purity (with one pragmatic exception).** Boxes are pure functions over immutable
   resource values. The one exception: a global registry captures every resource ever returned by a
   box, so that `synth()` can collect them.

3. **Two rules for the registry:**
    - Everything returned by a box can be safely ignored by the caller.
    - Everything ever returned by a box will end up in the template, even if ignored.
    - A special `discard` box allows opting a resource out.

4. **Resources at the top level.** Primary resources (buckets, functions, tables — anything with
   user-visible identity) should be created at the top level via generators with explicit logical
   IDs. Reusable boxes should prefer to receive resources as inputs rather than creating them.

5. **Generators and transformers.** Generators create resources (`I → Resource`). Transformers
   modify resources or wire them together (`A ⊗ B → A ⊗ B ⊗ C`). Transformers may create auxiliary
   resources (policies, mappings, etc.) whose logical IDs are derived from their inputs.

6. **No construct tree.** Logical IDs are not derived from program structure. They are either
   explicit (generators) or deterministically derived from input resource IDs (auxiliary resources).
   This makes refactoring safe — reorganizing boxes doesn't change logical IDs.

## Type System

### Resources

A resource is branded by its CloudFormation type string:

```typescript
type Resource<T extends string = string> = {
  readonly __type: T;
  readonly logicalId: string;
  readonly properties: Record<string, unknown>;
};

type Bucket = Resource<"AWS::S3::Bucket"> & { properties: S3BucketProps };
```

### Boxes are plain functions

No wrapper type required for basic usage. TypeScript infers composite types naturally:

```typescript
function encrypt(bucket: Bucket): Bucket;

function grantRead(fn: Function, bucket: Bucket): [Function, Bucket, Policy];
```

A `Box` wrapper is available for metadata/introspection/tooling but not required.

### Tokens

Property values that reference other resources use **tokens** — opaque strings that resolve to
CloudFormation intrinsics at synth time:

```typescript
const arn = getAtt(role, "Arn");  // returns string: "${Token[t42]}"
```

- Property interfaces stay clean (`string`, `number`, not union types).
- String interpolation works naturally: `` `${arn}/*` ``.
- The framework resolves tokens to `Ref`, `Fn::GetAtt`, `Fn::Join`, etc. during synth.
- Box authors can inspect tokens via `extractLogicalId(tokenString)` when they need to navigate
  references.

`getAtt` is type-safe — attribute names are checked against a union generated from the
CloudFormation spec.

### Typed references (Option C)

For common structural relationships (Function→Role, etc.), generators accept the referenced resource
as a separate typed argument rather than a raw string:

```typescript
function mkFunction(id: string, props: Omit<LambdaFunctionProps, "role">, role: Role): Function;
```

The generator stores both the token in `properties.role` and the resource object in a typed field (
`fn.role`). Boxes that need to navigate (e.g., `grantRead` finding the role to attach a policy) use
the typed field.

### No subtyping/refinement

Resources are typed only by their CloudFormation type. There are no `EncryptedBucket` or
`WebHostedBucket` subtypes. Boxes enforce contracts at runtime (idempotent behavior, conflict
errors, etc.).

### No linear types

Wires can be forked (same resource fed to multiple boxes in parallel). Conflicts are detected at
synth time via merge semantics, not at compile time.

## Merge Semantics

### Sequential composition

A transformer returns a new resource value (same logical ID, updated properties). The registry
receives it as a new patch.

### Parallel composition

Two boxes may independently modify the same resource on separate paths. At synth time, patches are
merged:

- **Objects:** deep recursive merge. Conflict only on same leaf key with different values.
- **Arrays:** conflict by default. Specific property paths (Tags, IAM Statements, security group
  rules) are marked as mergeable collections (concatenation).
- **Scalars:** conflict if different, no-op if same.

Conflicts produce clear error messages citing both origin boxes and the conflicting path.

## Logical IDs

1. **Generators:** logical ID is mandatory, provided by the user.
2. **Auxiliary resources created by boxes:** logical ID is derived deterministically from input
   resource logical IDs (e.g., `deriveId(role, bucket, "ReadPolicy")` →
   `"MyRoleContentBucketReadPolicy"`).
3. **If an auxiliary resource has no resource dependencies:** logical ID must be provided by the
   caller (passed as parameter to the box).

Derived IDs are truncated with a hash suffix if they exceed 64 characters.

## Synth

`synth()` takes no arguments. It flushes the global registry:

1. **Merge** patches per logical ID (deep merge, detect conflicts).
2. **Remove** discarded resources.
3. **Resolve** tokens in all property values → CloudFormation intrinsics.
4. **Compute** `DependsOn` from resolved `Ref`/`Fn::GetAtt` references.
5. **Validate** (refs resolve, no cycles, required properties present, template limits).
6. **Emit** one or more CloudFormation templates.

Output is a `SynthOutput`:

```typescript
type SynthOutput = {
  templates: Record<string, Template>;
  assets: AssetManifest;
};
```

## Stacks

Stacks are NOT boxes. They are a **partitioning concern** — orthogonal to composition logic. A stack
defines a deployment boundary (atomic deploy, rollback boundary, lifecycle boundary), not a
composition boundary.

Stack assignment is a label on resources:

```typescript
const bucket = mkBucket("Content", {}, {stack: "frontend"});
const fn = mkFunction("Processor", {/* ... */}, role, {stack: "backend"});
```

At synth time, the framework:

1. Groups resources by stack label (auxiliary resources inherit from primary dependency).
2. For each cross-stack reference (token in stack B referencing resource in stack A):
   - Adds an `Output` to stack A
   - Replaces the token in stack B with `Fn::GetStackOutput`
3. Computes inter-stack deployment order from cross-references.

Composition (boxes, wires) defines *what* exists and *how* it's connected. Partitioning (stacks)
defines *where* things deploy. These are separate layers.

Note: logical IDs and stack labels are both "deployment identity" — orthogonal to composition but
with real infrastructure consequences when changed.

## Parameters

CloudFormation parameters are the inputs to the top-level box. The app receives them and threads
them through composition:

```typescript
const app = createApp({
  parameters: {
    DomainName: {type: "String"},
    Environment: {type: "String", allowedValues: ["prod", "staging"]},
  },
});

app.run(({DomainName, Environment}) => {
  const cert = mkCertificate("Cert", {domainName: DomainName});
  // ...
});
```

## Assets

Assets are local artifacts (files, directories, Docker contexts) that must be uploaded before
deployment.

### Asset as a wire participant

```typescript
const handlerCode = mkAsset("HandlerCode", {
  type: "bundle",
  path: "./src/handler",
  bundler: {runtime: "nodejs20.x", command: "esbuild"},
});

const fn = mkFunction("Handler", {
  runtime: "nodejs20.x",
  handler: "index.handler",
  code: {s3Bucket: handlerCode.s3Bucket, s3Key: handlerCode.s3Key},
}, role);
```

Assets produce tokens (`s3Bucket`, `s3Key`, `s3Url`, or `imageUri` for Docker) that the deployment
tool fills in after uploading.

### Docker assets

```typescript
const image = mkDockerAsset("ApiImage", "./services/api");
// image.imageUri is a token resolved after push to ECR
```

### Synth does not build

`synth()` records what needs to be built (source paths, bundler configs) and emits an asset
manifest. The deployment tool handles bundling, hashing, uploading, and substituting locations into
the template.

### Staging

The user provides a staging bucket explicitly:

```typescript
const app = createApp({
  staging: {bucket: "my-staging-bucket-123456", prefix: "assets/"},
});
```

## Code Generation

From the CloudFormation resource spec (e.g., `cdklabs/awscdk-service-spec`), we generate per
service:

- Property interfaces (all optional except required properties)
- Attribute key unions (for type-safe `getAtt`)
- Generator functions (with typed reference arguments for structural relationships)
- Mergeable collection annotations (which array properties support concatenation)

## Categorical Semantics (informal)

- Objects in the category: tuples of CloudFormation resource types.
- Morphisms: boxes (functions from resource tuples to resource tuples).
- Monoidal product (⊗): parallel wires.
- Sequential composition (∘): function application / data flow.
- Braiding: implicit via variable binding (no explicit swap needed).
- Comonoid (copying): forking a wire to feed multiple boxes.
- Partial monoid (merging): synth-time merge of parallel modifications.

The composition of all boxes in an application forms a single morphism from parameters to the full
set of resources.

## Differences from CDK

| CDK                                                 | This framework                                    |
|-----------------------------------------------------|---------------------------------------------------|
| Construct tree, implicit resource creation          | Flat composition, explicit resource flow          |
| Logical IDs from tree path (refactoring breaks IDs) | IDs explicit or derived from dependencies         |
| `grant*` mutates constructs via side effects        | `grant*` returns new values + auxiliary resources |
| Resources hidden inside constructs                  | Every resource visible on a wire                  |
| Scope determines ownership                          | Boxes are context-free                            |
| Single template output model                        | Templates + asset manifest                        |

## Non-Resource Template Sections

Only **resources** flow on wires. Everything else is either a declaration that produces tokens, or
configuration on the app/stack boundary.

| Section             | Model                                                        | Mechanism                                       |
|---------------------|--------------------------------------------------------------|-------------------------------------------------|
| Resources           | Boxes (generators + transformers)                            | Registry patches                                |
| Outputs             | Return value of `stack` box                                  | Wires leaving the stack boundary become Outputs |
| Parameters          | Inputs to top-level box                                      | Part of `createApp`                             |
| Mappings            | Declared values + `findInMap` token minter                   | Registered separately                           |
| Conditions          | Declared values + `when` box + `fnIf` token minter           | Registered separately; validation at synth      |
| Metadata (template) | Part of `createApp` config                                   | Emitted directly                                |
| Metadata (resource) | `addMetadata` transformer box                                | Patches a non-properties field                  |
| Transform           | Part of `createApp` config                                   | Emitted directly                                |

### Mappings

```typescript
const regionAmi = mkMapping("RegionAMI", {
  "us-east-1": {HVM64: "ami-0123456789"},
  "eu-west-1": {HVM64: "ami-9876543210"},
});

const ami = findInMap(regionAmi, ref(pseudoParam("AWS::Region")), "HVM64");
// token resolving to { "Fn::FindInMap": ["RegionAMI", {"Ref": "AWS::Region"}, "HVM64"] }
```

### Conditions

Conditions are deploy-time constructs. The framework cannot branch on them at synth time.

```typescript
const isProd = mkCondition("IsProd", fnEquals(ref(environment), "prod"));

// Make a resource conditional
const alarmTopic = when(mkTopic("AlarmTopic", {}), isProd);

// Conditional property values
const logLevel = fnIf(isProd, "ERROR", "DEBUG");
```

Condition combinators: `fnAnd`, `fnOr`, `fnNot` compose conditions into new conditions.

Synth-time validation: warn if an unconditional resource references a conditional one without using
`fnIf`.

### Metadata (resource-level)

```typescript
const instance2 = addMetadata(instance, {
  "AWS::CloudFormation::Init": { /* ... */ },
});
```

## Tooling

### Architecture

Two separate applications sharing the cloud assembly format:

- **`skein` CLI** — synth, deploy, diff. Lightweight, runs everywhere (CI/CD, SSH, scripting).
- **`skein studio`** — visual editor. Reads/writes the same project files. Calls `skein synth` to refresh.

### Cloud Assembly

The output of `synth`. A directory on disk read by the deploy tool:

```
.cloud-assembly/
├── manifest.json          # stacks, dependencies, asset references
├── graph.json             # wiring diagram IR (for GUI)
├── stacks/
│   ├── frontend.template.json
│   └── backend.template.json
├── assets/
│   └── HandlerCode/
│       ├── source.json    # { type: "bundle", path: "../../src/handler", ... }
│       └── hash
└── config.json            # staging bucket, region, account
```

### CLI Operations (v1)

- **`skein synth`** — runs the TypeScript program, writes `.cloud-assembly/`. Fast, deterministic,
  side-effect-free. Safe to run in CI for diffing templates.
- **`skein deploy`** — reads the assembly, builds/uploads assets, submits templates to CloudFormation.

Deploy pipeline:

1. Read manifest
2. Build assets (esbuild, docker build, zip)
3. Hash outputs, skip unchanged
4. Upload to staging bucket / ECR
5. Substitute asset locations into templates
6. Submit to CloudFormation (create/update stacks in dependency order)
7. Wait for completion, stream events

### Graph IR

The framework records box calls at runtime, emitting `graph.json` alongside templates:

```json
{
  "nodes": [
    {"id": "n1", "box": "mkBucket", "params": {"logicalId": "Content", "props": {}}},
    {"id": "n2", "box": "encrypt", "params": {}},
    {"id": "n3", "box": "enableWebHosting", "params": {}}
  ],
  "edges": [
    {"from": "n1", "output": 0, "to": "n2", "input": 0},
    {"from": "n2", "output": 0, "to": "n3", "input": 0}
  ]
}
```

Every box call is recorded (generators, transformers, wirers). The GUI filters/groups for display.

### Visual Editor (skein studio)

Built with React Flow / xyflow. Reads `graph.json` to render the wiring diagram.

**Navigation:** zoom into boxes (see their internal composition) and zoom out (see the containing
box). All levels of nesting are explorable.

**Code generation:** the GUI produces TypeScript from the graph (topological sort → sequential
variable assignments). For v1, regeneration overwrites the source file entirely. The GUI is an
additional layer over the code, not the authoritative source.

**Round-trip:** edit code → `skein synth` → updated `graph.json` → GUI reflects changes. Edit in GUI →
regenerate code → same result. For complex logic (loops, conditionals, helper functions), the GUI
shows the executed graph (result of running the code), not the source structure.

## Differences from CDK

| CDK                                                  | This framework                                    |
|------------------------------------------------------|---------------------------------------------------|
| Construct tree, implicit resource creation           | Flat composition, explicit resource flow          |
| Logical IDs from tree path (refactoring breaks IDs)  | IDs explicit or derived from dependencies         |
| `grant*` mutates constructs via side effects         | `grant*` returns new values + auxiliary resources |
| Resources hidden inside constructs                   | Every resource visible on a wire                  |
| Scope determines ownership                           | Boxes are context-free                            |
| Single template output model                         | Cloud assembly (templates + assets + graph)       |

## Open Questions

- Linting/enforcement — how to encourage "generators at the top" as a practice?
- Testing patterns — asserting on intermediate wire states vs. final template output?
- Multi-account / multi-region — how does the `stack` box handle environment targeting?
- Incremental synth — can the framework avoid re-running the entire program when only one box changed?
