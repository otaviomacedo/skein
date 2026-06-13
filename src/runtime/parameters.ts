import { mintToken } from "./tokens.js";

export type ParameterDefinition = {
  type: string;
  default?: string;
  description?: string;
  allowedValues?: string[];
  constraintDescription?: string;
  maxLength?: number;
  minLength?: number;
  maxValue?: number;
  minValue?: number;
  noEcho?: boolean;
};

export type Parameter = {
  readonly __kind: "parameter";
  readonly name: string;
  readonly definition: ParameterDefinition;
};

const parameters = new Map<string, ParameterDefinition>();

export function mkParameter(name: string, definition: ParameterDefinition): Parameter {
  parameters.set(name, definition);
  return { __kind: "parameter", name, definition };
}

export function paramRef(param: Parameter): string {
  return mintToken({ kind: "ref", logicalId: param.name });
}

export function pseudoParam(name: string): string {
  return mintToken({ kind: "ref", logicalId: name });
}

export function getParameters(): Map<string, ParameterDefinition> {
  return parameters;
}

export function resetParameters(): void {
  parameters.clear();
}
