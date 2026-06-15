# Design Guidelines for Boxes

Principles for authoring composable boxes in Skein. This is a living document — new principles are
added as patterns emerge from use.

---

## 1. Inputs: Resources vs. Creation Props

**Take resources as inputs when they have independent lifecycle; take creation props only for
resources intrinsic to the pattern.**

A resource has independent lifecycle if it could reasonably be shared with other boxes, created
by a different team, or outlive the pattern that uses it. These should be passed in as
already-created resource objects.

A resource is intrinsic if it only exists to serve the pattern — it wouldn't make sense to create
it separately and plug it in. For these, the box takes creation props and builds the resource
internally.

Examples:

- `crudApi` takes a `Table` (independent — could be shared with background workers or admin
  tools) but takes `SimpleFunctionProps` to create its handler Lambda (intrinsic — the handler
  only exists to serve this API).
- `scheduledProcessor` takes a `Table` and `Queue` (independent) but creates the Lambda and IAM
  resources internally (intrinsic).
- `grantTableReadWrite` takes both a `Function` and a `Table` (both already exist, both have
  independent lifecycle).

The graph benefits too: input wires represent real data-flow between independent subsystems.
Resources built internally are nested inside the composite node.

---

## 2. Outputs: Tuples vs. Objects

**Tuples for transformer boxes (pipe-compatible); objects for pattern boxes (subsystem builders).**

A **transformer** takes a primary resource, augments or modifies it, and passes it along. It
returns a tuple where the first element is the primary (the wire that keeps flowing through
`pipe()`), and remaining elements are by-products.

```typescript
// Transformer: primary is fn, by-product is the policy
const grantTableReadWrite = box("grantTableReadWrite",
  (fn: Function, table: Table): [Function, Table, Policy] => { ... }
);
```

A **pattern** (also called a subsystem or composite) assembles multiple resources into a
coherent whole. There is no single "primary" — the caller may use any of the outputs
independently. It returns a named object.

```typescript
// Pattern: multiple independently meaningful outputs
const crudApi = box("crudApi",
  (logicalId: string, props: CrudApiProps): CrudApi => { ... }
);
// CrudApi = { handler, restApi, stageUrl }
```

The rule of thumb: if the box is meant to appear in a `pipe()` chain, use a tuple. If the box
is a standalone call whose outputs feed different downstream paths, use an object.

---

## 3. Output Objects Are Readonly

**All properties in object output types must be `readonly`.**

Box outputs represent the result of a composition that has already happened. The caller should
wire these outputs into other boxes, not mutate them. Marking all fields `readonly` makes this
intent explicit and prevents accidental re-assignment.

```typescript
export type CrudApi = {
  readonly handler: LambdaFunction;
  readonly restApi: RestApi;
  readonly stageUrl: string;
};
```

For array-valued fields, use `readonly` on both the property and the array:

```typescript
export type Fanout = {
  readonly subscriptions: readonly FanoutSubscription[];
};
```

Note: this applies to output *object types* of pattern boxes, not to tuple outputs of
transformer boxes (tuples are already positional and short-lived — they get destructured
immediately).

---

## 4. Layered Abstraction: Opinionated Boxes Compose Mid-Level Boxes

**High-level opinionated boxes should compose from exposed mid-level boxes, not inline
primitives.**

A common failure mode in IaC frameworks (see CDK's `Vpc` → `VpcV2` evolution) is the "God
constructor" — a single abstraction that makes every decision at once, giving users no way to
opt into *some* opinions without accepting all of them. When requirements diverge from the
happy path, users must drop all the way down to raw resources.

In Skein, avoid this by structuring in two layers:

1. **Mid-level wiring boxes** — small, composable boxes that encode one routing/plumbing
   decision (e.g., "attach an IGW", "create a NAT route table", "associate a subnet with a
   route table"). These are exported and documented for direct use.

2. **High-level opinionated boxes** — compose the mid-level boxes into a complete subsystem
   for the happy path. Users who need a custom topology reuse the mid-level boxes with
   different wiring.

```typescript
// Mid-level: reusable independently
export const attachInternetGateway = box("attachInternetGateway", ...);
export const publicRouteTable = box("publicRouteTable", ...);
export const natRouteTable = box("natRouteTable", ...);
export const associateRouteTable = box("associateRouteTable", ...);

// High-level: composes the above for the 80% case
export const vpc = box("vpc", (logicalId, props) => {
  const igw = attachInternetGateway(logicalId, vpcResource);
  const pubRt = publicRouteTable(..., igw);
  // ... combines mid-level boxes
});
```

This is where Skein's functional style shines compared to OOP frameworks. In the CDK, a
construct owns its children — you can't extract one wiring decision and reuse it elsewhere
without inheritance gymnastics. In Skein, boxes are just functions: the mid-level boxes don't
know or care whether they're called from inside `vpc` or from user code directly. Composition
is free.