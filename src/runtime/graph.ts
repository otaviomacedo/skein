export type WireRef = {
  resourceId: string;
  type: string;
};

export type BoxCall = {
  id: string;
  box: string;
  inputs: WireRef[];
  outputs: WireRef[];
  parent?: string;
  children: string[];
};

export type GraphEdge = {
  from: string;
  output: number;
  to: string;
  input: number;
};

export type GraphIR = {
  nodes: BoxCall[];
  edges: GraphEdge[];
};

let callCounter = 0;
const calls: BoxCall[] = [];
const callsById = new Map<string, BoxCall>();
const edges: GraphEdge[] = [];
const latestProducer = new Map<string, { callId: string; outputIndex: number }>();
const callStack: string[] = [];

export function recordBoxCall(
  box: string,
  inputs: WireRef[],
  outputs: WireRef[],
): string {
  const id = `n${callCounter++}`;
  const parent = callStack.length > 0 ? callStack[callStack.length - 1] : undefined;
  const call: BoxCall = { id, box, inputs, outputs, parent, children: [] };
  calls.push(call);
  callsById.set(id, call);

  if (parent) {
    callsById.get(parent)!.children.push(id);
  }

  // Record edges from previous producer to this node's inputs
  for (let i = 0; i < inputs.length; i++) {
    const origin = latestProducer.get(inputs[i].resourceId);
    if (origin) {
      edges.push({
        from: origin.callId,
        output: origin.outputIndex,
        to: id,
        input: i,
      });
    }
  }

  // Update latest producer for each output
  for (let i = 0; i < outputs.length; i++) {
    latestProducer.set(outputs[i].resourceId, { callId: id, outputIndex: i });
  }

  return id;
}

export function pushBoxContext(callId: string): void {
  callStack.push(callId);
}

export function popBoxContext(): void {
  callStack.pop();
}

export function updateBoxOutputs(callId: string, outputs: WireRef[]): void {
  const call = callsById.get(callId);
  if (!call) return;
  call.outputs = outputs;

  for (let i = 0; i < outputs.length; i++) {
    latestProducer.set(outputs[i].resourceId, { callId, outputIndex: i });
  }
}

export function buildGraph(): GraphIR {
  return { nodes: [...calls], edges: [...edges] };
}

export function resetGraph(): void {
  callCounter = 0;
  calls.length = 0;
  callsById.clear();
  edges.length = 0;
  latestProducer.clear();
  callStack.length = 0;
}
