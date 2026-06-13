// Re-export the public API for user apps
export * from "./lib/index.js";
export { ref, getAtt, fnJoin, fnSub, fnSelect, deriveId } from "./runtime/resource.js";
export { synth, synthMulti } from "./runtime/synth.js";
export { mkCondition, fnEquals, fnAnd, fnOr, fnNot, fnIf } from "./runtime/conditions.js";
export { mkMapping, findInMap } from "./runtime/mappings.js";
export { mkParameter, paramRef, pseudoParam } from "./runtime/parameters.js";
export { output } from "./runtime/outputs.js";
export { assignStack } from "./runtime/stacks.js";
export { mkAsset, mkDockerAsset } from "./runtime/assets.js";
export { discard } from "./runtime/registry.js";
export { box } from "./runtime/box.js";
