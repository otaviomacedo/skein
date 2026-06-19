import type { Function } from "../lib/lambda.js";
import { updateResource } from "../runtime/registry.js";
import { box } from "../runtime/box.js";

export const addEnvironment = box(
  "addEnvironment",
  (fn: Function, key: string, value: string): Function => {
    const existing = fn.properties.environment?.variables ?? {};
    const properties = {
      ...fn.properties,
      environment: {
        variables: { ...existing, [key]: value },
      },
    };
    updateResource(fn.logicalId, fn.__type, properties);
    return { ...fn, properties } as Function;
  },
);

export const setTimeout = box("setTimeout", (fn: Function, seconds: number): Function => {
  const properties = {
    ...fn.properties,
    timeout: seconds,
  };
  updateResource(fn.logicalId, fn.__type, properties);
  return { ...fn, properties } as Function;
});

export const setMemorySize = box("setMemorySize", (fn: Function, mb: number): Function => {
  const properties = {
    ...fn.properties,
    memorySize: mb,
  };
  updateResource(fn.logicalId, fn.__type, properties);
  return { ...fn, properties } as Function;
});
