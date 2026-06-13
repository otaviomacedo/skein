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
