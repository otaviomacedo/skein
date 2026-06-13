# Implementation Plan

A phased plan for building Monoidal Constructs. Each phase produces something usable and testable
before the next begins.

---

## Phase 1: Core Runtime

The minimal engine — tokens, registry, merge, synth. No code-gen, no CLI, no GUI. Tests exercise
the runtime directly.

### 1.1 Project scaffolding

- [ ] Initialize TypeScript project (tsconfig, package.json, vitest or similar)
- [ ] Directory structure: `src/runtime/`, `src/generated/` (empty for now), `src/boxes/`, `tests/`
- [ ] Linting, formatting baseline

### 1.2 Token system

- [ ] `mintToken`, `resolveValue`, `resolveString`
- [ ] Token registry (Map<id, Resolvable>)
- [ ] Resolvable types: ref, getAtt, sub, join, select
- [ ] `isToken`, `extractLogicalId` utilities
- [ ] Tests: token minting, resolution of pure tokens, embedded tokens in strings, nested objects

### 1.3 Resource model

- [ ] `Resource<T>` type definition
- [ ] `ref(resource)` and `getAtt(resource, attribute)` — mint tokens
- [ ] Manual resource types for testing (Bucket, Role, Function, Policy — hand-written, not
  generated)
- [ ] Generator functions for those types (mkBucket, mkRole, mkFunction, mkPolicy)
- [ ] Typed references (e.g., Function carries `.role: Role`)

### 1.4 Registry and patches

- [ ] Global patch list
- [ ] `registerResource` called by generators
- [ ] Patch structure: origin, logicalId, type, properties
- [ ] `deriveId` utility

### 1.5 Merge engine

- [ ] `deepMerge` — recursive object merge, conflict detection
- [ ] Array handling: conflict by default, mergeable collection config
- [ ] `mergePatchesByLogicalId` — group and merge all patches per logical ID
- [ ] Conflict error messages (cite origin boxes, conflicting path)
- [ ] Tests: compatible merges, conflicting merges, array behavior

### 1.6 Synth

- [ ] Merge patches
- [ ] Discard handling
- [ ] Token resolution across all properties
- [ ] DependsOn computation from resolved intrinsics
- [ ] Validation (refs resolve, no cycles)
- [ ] Template emission (JSON)
- [ ] Tests: end-to-end — generators + transformers → valid CloudFormation template

### 1.7 Non-resource sections

- [ ] Conditions: `mkCondition`, `fnIf`, `fnAnd`, `fnOr`, `fnNot`, `when` box
- [ ] Mappings: `mkMapping`, `findInMap`
- [ ] Parameters: parameter declarations, `ref` to parameters
- [ ] Outputs: `output()` registration
- [ ] Metadata: `addMetadata` box
- [ ] Pseudo-parameters: `AWS::Region`, `AWS::StackId`, etc.

---

## Phase 2: Hand-Written Boxes

A small library of real boxes, exercising the runtime with realistic CloudFormation patterns. This
validates the design before investing in code-gen.

### 2.1 S3 boxes

- [ ] `encrypt`, `enableVersioning`, `enableWebHosting`, `enableLogDelivery`
- [ ] `blockPublicAccess`, `addLifecycleRule`, `addCorsRule`

### 2.2 IAM boxes

- [ ] `grantRead(fn, bucket)`, `grantWrite(fn, bucket)`, `grantReadWrite(fn, bucket)`
- [ ] `grantInvoke(callerFn, targetFn)`
- [ ] `addManagedPolicy(role, policyArn)`

### 2.3 CloudFront boxes

- [ ] `setOrigin(distribution, bucket, oai)`
- [ ] `enableAccessLogging(distribution, logBucket)`
- [ ] `attachCert(distribution, certificate)`
- [ ] `addAliasRecord(distribution, config)`

### 2.4 Lambda boxes

- [ ] `addEnvironment(fn, key, value)`
- [ ] `attachLayer(fn, layerAsset)`
- [ ] `setVpc(fn, vpc, subnets, securityGroups)`

### 2.5 Integration tests

- [ ] Compose boxes into non-trivial programs (static site, API + queue, etc.)
- [ ] Assert output templates are valid CloudFormation (schema validation)
- [ ] Snapshot tests for template stability

---

## Phase 3: Code Generation

Auto-generate resource types, generators, and attribute unions from the CloudFormation spec.

### 3.1 Spec ingestion

- [ ] Pull resource spec (from `cdklabs/awscdk-service-spec` or raw CloudFormation JSON)
- [ ] Parse resource types, property shapes, attributes, required fields
- [ ] Identify cross-resource references (properties that are Ref/GetAtt to other types)

### 3.2 Code generator

- [ ] Emit property interfaces per resource type
- [ ] Emit attribute key unions per resource type
- [ ] Emit generator functions (mkBucket, mkFunction, etc.)
- [ ] Detect and emit typed references (e.g., Function takes Role)
- [ ] Emit mergeable collection annotations (Tags, Statements, etc.)
- [ ] Output to `src/generated/` (one file per service namespace)

### 3.3 Validation

- [ ] Ensure hand-written boxes from Phase 2 still work with generated types
- [ ] Compare generated types against hand-written ones, retire hand-written versions

---

## Phase 4: Stacks and Assets

Multi-stack support and asset pipeline.

### 4.1 Stack partitioning

- [ ] Stack label on generators (optional `{ stack: "name" }` config)
- [ ] Stack inheritance for derived resources
- [ ] Cross-stack reference detection at synth time
- [ ] Automatic Output + Fn::GetStackOutput insertion
- [ ] Inter-stack dependency ordering
- [ ] Multi-template emission

### 4.2 Assets (S3)

- [ ] `mkAsset` — register asset source, mint s3Bucket/s3Key/s3Url tokens
- [ ] Asset manifest emission alongside templates
- [ ] Content hashing (source tree hash)
- [ ] AssetSource types: file, directory, bundle

### 4.3 Assets (Docker)

- [ ] `mkDockerAsset` — register docker build context, mint imageUri token
- [ ] Docker-specific manifest entries (ECR destination)

### 4.4 Cloud assembly structure

- [ ] Directory layout: manifest.json, stacks/, assets/, config.json
- [ ] Manifest schema: stacks (with dependencies), assets (with destinations)
- [ ] `synth()` writes the assembly to disk

---

## Phase 5: CLI (mc)

The command-line tool for synth and deploy.

### 5.1 CLI scaffolding

- [ ] CLI framework (e.g., commander, yargs, or minimal custom)
- [ ] `skein synth` — run entrypoint via tsx, produce cloud assembly
- [ ] `skein diff` — synth + show template diff against last assembly or deployed state

### 5.2 Deploy

- [ ] Read cloud assembly
- [ ] Asset building (invoke esbuild/zip/docker as needed)
- [ ] Asset hashing and deduplication (skip unchanged)
- [ ] Asset upload to staging bucket (S3) / ECR
- [ ] Token substitution (asset locations into templates)
- [ ] CloudFormation create/update stack (SDK calls)
- [ ] Stack dependency ordering (deploy in topological order)
- [ ] Event streaming (poll stack events, display progress)
- [ ] Rollback detection and reporting

### 5.3 Other operations (later)

- [ ] `skein destroy` — delete stacks in reverse dependency order
- [ ] `skein list` — show deployed stacks and their status
- [ ] `skein outputs` — show stack outputs

---

## Phase 6: Graph IR and Visual Editor

The wiring diagram GUI.

### 6.1 Graph recording

- [ ] Extend runtime: register BoxCall (id, box name, inputs, outputs) on each box invocation
- [ ] Emit `graph.json` as part of cloud assembly
- [ ] Graph schema: nodes (box calls) + edges (wire connections)

### 6.2 GUI scaffolding

- [ ] React + React Flow / xyflow project
- [ ] Load `graph.json`, render nodes and edges
- [ ] Box rendering: inputs on left, outputs on right, label in center
- [ ] Wire rendering: typed (color/style per resource type?)

### 6.3 Navigation

- [ ] Zoom into composite boxes (show internals)
- [ ] Zoom out (show containing box)
- [ ] Collapse/expand boxes at different nesting levels

### 6.4 Editing

- [ ] Drag boxes from a palette onto the canvas
- [ ] Connect output ports to input ports (type-checked)
- [ ] Configure box parameters (properties panel)
- [ ] Delete boxes/wires

### 6.5 Code generation from GUI

- [ ] Topological sort of graph
- [ ] Emit TypeScript: generators → transformers → wirers → synth()
- [ ] Full file regeneration (overwrite)

### 6.6 Round-trip

- [ ] `skein synth` refreshes graph.json → GUI reloads
- [ ] GUI edits → regenerate code → skein synth → verify

---

## Phase 7: Polish and Ecosystem

### 7.1 Error messages

- [ ] Improve conflict errors (suggest sequencing)
- [ ] Improve validation errors (missing required properties, broken refs)
- [ ] Stack trace to origin box for all errors

### 7.2 Documentation

- [ ] Getting started guide
- [ ] Box authoring guide
- [ ] Architecture overview

### 7.3 Linting

- [ ] "Generators at the top level" lint rule
- [ ] "Don't perform string operations on tokens" lint rule
- [ ] Unused resource detection (resource created but never in a meaningful output path)

### 7.4 Testing utilities

- [ ] `synthTest()` — synth in an isolated context, return template for assertions
- [ ] Template matchers (hasResource, hasOutput, resourceCountIs, etc.)
- [ ] Snapshot testing helpers

---

## Dependencies Between Phases

```
Phase 1 (Core Runtime)
   │
   ├──→ Phase 2 (Boxes) ──→ Phase 3 (Code Gen)
   │                              │
   │                              ▼
   └──────────────────────→ Phase 4 (Stacks & Assets)
                                  │
                                  ▼
                            Phase 5 (CLI)
                                  │
                                  ▼
                            Phase 6 (GUI)
                                  │
                                  ▼
                            Phase 7 (Polish)
```

Phases 2 and 3 can partially overlap (hand-written boxes inform code-gen requirements).
Phase 4 depends on Phase 1 but not on Phase 3 (can use hand-written types).
Phase 5 depends on Phase 4 (needs cloud assembly structure).
Phase 6 depends on Phase 5 (needs synth to produce graph.json).

---

## Current Status

- [x] Design document (DESIGN.md)
- [x] Categorical semantics (CATEGORICAL-SEMANTICS.md)
- [x] Phase 1: Core Runtime (tokens, resources, registry, merge, synth, conditions, mappings, parameters, outputs)
- [x] Phase 2: Hand-Written Boxes (S3, IAM, CloudFront, Lambda)
- [x] Phase 3: Code Generation (1601 resource types, type-checks cleanly)
- [x] Phase 4: Stacks & Assets (multi-stack partitioning, cross-stack refs, S3/Docker assets)
- [x] Phase 5: CLI — `skein synth` and `skein diff` working end-to-end
- [x] Phase 6: GUI — graph IR recording, graph.json emission, React Flow studio (renders wiring diagram)
- [x] Phase 7: Polish — improved errors (ConflictError, ReferenceError, CycleError with hints/cycle paths), testing utilities (synthTest, hasResource, hasOutput, resourceOfType, etc.)
- [ ] Next: build a non-trivial real app to validate, then iterate
