export type OutputDefinition = {
  value: unknown;
  description?: string;
  exportName?: string;
  condition?: string;
};

const outputs = new Map<string, OutputDefinition>();

export function output(name: string, value: unknown, opts?: Omit<OutputDefinition, "value">): void {
  outputs.set(name, { value, ...opts });
}

export function getOutputs(): Map<string, OutputDefinition> {
  return outputs;
}

export function resetOutputs(): void {
  outputs.clear();
}
