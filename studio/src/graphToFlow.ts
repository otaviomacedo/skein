import { type Node, type Edge, MarkerType } from "@xyflow/react";
import { GraphIR, BoxCall } from "./types";
import { BoxNodeData } from "./BoxNode";

const SERVICE_COLORS: Record<string, string> = {
  "AWS::S3": "#3F8624",
  "AWS::Lambda": "#D86613",
  "AWS::IAM": "#DD344C",
  "AWS::CloudFront": "#8C4FFF",
  "AWS::Route53": "#4B612C",
  "AWS::DynamoDB": "#2E73B8",
  "AWS::SQS": "#D6551D",
  "AWS::SNS": "#A1325C",
  "AWS::Events": "#E7A33E",
  "AWS::CloudWatch": "#E7157B",
  "AWS::ApiGateway": "#A166FF",
  "AWS::CertificateManager": "#1A8F73",
};

function getColor(type: string): string {
  const prefix = type.split("::").slice(0, 2).join("::");
  return SERVICE_COLORS[prefix] ?? "#6B7280";
}

function getPrimaryColor(node: BoxCall): string {
  const primary = node.outputs[0] ?? node.inputs[0];
  return primary ? getColor(primary.type) : "#6B7280";
}

function shortType(type: string): string {
  return type.split("::")[2] ?? type;
}

export function graphToFlow(
  graph: GraphIR,
  expandedNodes: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  // Determine which nodes are visible:
  // A node is visible if:
  // 1. It has no parent (top-level), OR
  // 2. Its parent is expanded (recursively up the chain)
  const visibleNodes = new Set<string>();
  for (const node of graph.nodes) {
    if (isVisible(node, nodesById, expandedNodes)) {
      visibleNodes.add(node.id);
    }
  }

  // Promote edges: if source or target is hidden, reroute to nearest visible ancestor
  const promotedEdges = promoteEdges(graph.edges, visibleNodes, nodesById);
  const levels = computeLevels(
    graph.nodes.filter((n) => visibleNodes.has(n.id)),
    promotedEdges,
  );

  const X_SPACING = 280;
  const Y_SPACING = 100;
  const levelCounts = new Map<number, number>();

  for (const node of graph.nodes) {
    if (!visibleNodes.has(node.id)) continue;

    const level = levels.get(node.id) ?? 0;
    const row = levelCounts.get(level) ?? 0;
    levelCounts.set(level, row + 1);

    const color = getPrimaryColor(node);
    const resourceIds = node.outputs.map((o) => o.resourceId);
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(node.id);

    // Show logicalId only for boxes that explicitly name their primary output.
    // Heuristic: a box is "named" if it's a constructor (no inputs) OR if it
    // produces an output not present in its inputs AND that output doesn't look
    // like a derived ID (i.e., it doesn't contain any input resourceId as a prefix).
    const inputIds = new Set(node.inputs.map((i) => i.resourceId));
    const createdOutput = node.outputs.find((o) => !inputIds.has(o.resourceId));
    const isConstructor = node.inputs.length === 0;
    const isDerivedId = createdOutput && [...inputIds].some(
      (id) => createdOutput.resourceId.includes(id),
    );
    const logicalId = createdOutput && (isConstructor || !isDerivedId)
      ? createdOutput.resourceId
      : undefined;

    const nodeData: BoxNodeData = {
      label: node.box,
      logicalId,
      resourceIds,
      inputNames: node.inputs.map((i) => i.resourceId),
      inputCount: node.inputs.length,
      outputCount: node.outputs.length,
      color,
      isGenerator: node.inputs.length === 0 && node.children.length === 0,
      isComposite: hasChildren,
      isExpanded,
      childCount: node.children.length,
    };

    nodes.push({
      id: node.id,
      position: { x: level * X_SPACING, y: row * Y_SPACING },
      data: nodeData,
      type: "box",
    });
  }

  // Edges: render promoted edges (deduplicated per source-target pair, no self-loops)
  const edgeSeen = new Set<string>();
  for (const edge of promotedEdges) {
    if (edge.from === edge.to) continue;
    const key = `${edge.from}-${edge.output}-${edge.to}-${edge.input}`;
    if (edgeSeen.has(key)) continue;
    edgeSeen.add(key);

    const sourceNode = nodesById.get(edge.from);
    const output = sourceNode?.outputs[edge.output];
    const color = output ? getColor(output.type) : "#94a3b8";

    edges.push({
      id: `${edge.from}-${edge.output}-${edge.to}-${edge.input}`,
      source: edge.from,
      sourceHandle: `out-${edge.output}`,
      target: edge.to,
      targetHandle: `in-${edge.input}`,
      type: "smoothstep",
      animated: false,
      style: { stroke: color, strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
    });
  }

  return { nodes, edges };
}

function isVisible(
  node: BoxCall,
  nodesById: Map<string, BoxCall>,
  expandedNodes: Set<string>,
): boolean {
  if (!node.parent) return true;
  const parent = nodesById.get(node.parent);
  if (!parent) return true;
  if (!expandedNodes.has(node.parent)) return false;
  return isVisible(parent, nodesById, expandedNodes);
}

function findVisibleAncestor(
  nodeId: string,
  visibleNodes: Set<string>,
  nodesById: Map<string, BoxCall>,
): string | null {
  if (visibleNodes.has(nodeId)) return nodeId;
  const node = nodesById.get(nodeId);
  if (!node?.parent) return null;
  return findVisibleAncestor(node.parent, visibleNodes, nodesById);
}

type PromotedEdge = { from: string; output: number; to: string; input: number };

function promoteEdges(
  edges: { from: string; output: number; to: string; input: number }[],
  visibleNodes: Set<string>,
  nodesById: Map<string, BoxCall>,
): PromotedEdge[] {
  const result: PromotedEdge[] = [];
  for (const edge of edges) {
    const from = findVisibleAncestor(edge.from, visibleNodes, nodesById);
    const to = findVisibleAncestor(edge.to, visibleNodes, nodesById);
    if (from && to) {
      result.push({ from, output: edge.output, to, input: edge.input });
    }
  }
  return result;
}

function computeLevels(nodes: BoxCall[], edges: { from: string; to: string }[]): Map<string, number> {
  const levels = new Map<string, number>();
  const incoming = new Map<string, Set<string>>();

  for (const node of nodes) {
    incoming.set(node.id, new Set());
  }
  for (const edge of edges) {
    incoming.get(edge.to)?.add(edge.from);
  }

  const queue: string[] = [];
  for (const [id, deps] of incoming) {
    if (deps.size === 0) {
      queue.push(id);
      levels.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) ?? 0;

    for (const edge of edges) {
      if (edge.from === current) {
        const nextLevel = Math.max(levels.get(edge.to) ?? 0, currentLevel + 1);
        levels.set(edge.to, nextLevel);
        incoming.get(edge.to)?.delete(current);
        if (incoming.get(edge.to)?.size === 0) {
          queue.push(edge.to);
        }
      }
    }
  }

  for (const node of nodes) {
    if (!levels.has(node.id)) levels.set(node.id, 0);
  }

  return levels;
}
