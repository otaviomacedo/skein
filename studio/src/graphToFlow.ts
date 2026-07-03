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

export function graphToFlow(
  graph: GraphIR,
  expandedNodes: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  // Determine which nodes are visible
  const visibleNodes = new Set<string>();
  for (const node of graph.nodes) {
    if (isVisible(node, nodesById, expandedNodes)) {
      visibleNodes.add(node.id);
    }
  }

  // Promote edges
  const promotedEdges = promoteEdges(graph.edges, visibleNodes, nodesById, expandedNodes);

  // Compute levels for top-level nodes (those without a visible expanded parent)
  const topLevelVisible = graph.nodes.filter(
    (n) => visibleNodes.has(n.id) && !isInsideExpandedParent(n, expandedNodes),
  );
  const topLevelEdges = promotedEdges.filter(
    (e) => !isInsideExpandedParent(nodesById.get(e.from)!, expandedNodes) ||
           !isInsideExpandedParent(nodesById.get(e.to)!, expandedNodes),
  );
  const topLevels = computeLevels(topLevelVisible, topLevelEdges);

  const X_SPACING = 280;
  const Y_SPACING = 100;
  const CHILD_X_SPACING = 220;
  const CHILD_Y_SPACING = 80;
  const GROUP_PADDING = 60;

  // Layout top-level nodes
  const levelCounts = new Map<number, number>();

  for (const node of graph.nodes) {
    if (!visibleNodes.has(node.id)) continue;

    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children.length > 0;
    const color = getPrimaryColor(node);
    const resourceIds = node.outputs.map((o) => o.resourceId);

    // Determine logicalId
    const inputIdSet = new Set(node.inputs.map((i) => i.resourceId));
    const createdOutput = node.outputs.find((o) => !inputIdSet.has(o.resourceId));
    const isConstructor = node.inputs.length === 0;
    const isDerivedId = createdOutput && [...inputIdSet].some(
      (id) => createdOutput.resourceId.includes(id),
    );
    const logicalId = createdOutput && (isConstructor || !isDerivedId)
      ? createdOutput.resourceId
      : undefined;

    // Is this node inside an expanded parent?
    const expandedParent = getExpandedParent(node, expandedNodes);

    if (expandedParent && isExpanded) {
      // This is an expanded node inside another expanded node — render as group inside group
      // For now, only support one level of nesting (expanded nodes at top level)
      continue;
    }

    if (expandedParent) {
      // This node is a child of an expanded parent — position relative to parent
      const siblings = nodesById.get(expandedParent)!.children
        .filter((cid) => visibleNodes.has(cid));
      const childIndex = siblings.indexOf(node.id);

      // Layout children in a grid inside the parent
      const childLevels = computeLevelsForChildren(siblings, promotedEdges, nodesById);
      const childLevel = childLevels.get(node.id) ?? 0;
      const childRow = countPrecedingAtLevel(node.id, childLevel, siblings, childLevels);

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
        position: {
          x: GROUP_PADDING + childLevel * CHILD_X_SPACING,
          y: GROUP_PADDING + 30 + childRow * CHILD_Y_SPACING,
        },
        data: nodeData,
        type: "box",
        parentId: expandedParent,
        extent: "parent" as const,
      });
    } else {
      // Top-level node
      const level = topLevels.get(node.id) ?? 0;
      const row = levelCounts.get(level) ?? 0;
      levelCounts.set(level, row + 1);

      if (isExpanded) {
        // Render as a group (large container)
        const childCount = node.children.filter((cid) => visibleNodes.has(cid)).length;
        const childLevels = computeLevelsForChildren(
          node.children.filter((cid) => visibleNodes.has(cid)),
          promotedEdges,
          nodesById,
        );
        const maxLevel = Math.max(0, ...childLevels.values());
        const maxRow = Math.max(0, ...countRowsPerLevel(childLevels).values());

        const groupWidth = Math.max(300, (maxLevel + 1) * CHILD_X_SPACING + GROUP_PADDING * 2);
        const groupHeight = Math.max(200, (maxRow + 1) * CHILD_Y_SPACING + GROUP_PADDING * 2 + 30);

        nodes.push({
          id: node.id,
          position: { x: level * X_SPACING, y: row * (groupHeight + 40) },
          data: {
            label: node.box,
            logicalId,
            resourceIds,
            inputNames: [],
            inputCount: 0,
            outputCount: 0,
            color,
            isGenerator: false,
            isComposite: true,
            isExpanded: true,
            childCount: node.children.length,
          } as BoxNodeData,
          type: "group",
          style: {
            width: groupWidth,
            height: groupHeight,
            background: `${color}08`,
            border: `2px dashed ${color}`,
            borderRadius: 12,
            padding: 10,
          },
        });
      } else {
        // Normal collapsed node
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
          isExpanded: false,
          childCount: node.children.length,
        };

        nodes.push({
          id: node.id,
          position: { x: level * X_SPACING, y: row * Y_SPACING },
          data: nodeData,
          type: "box",
        });
      }
    }
  }

  // Edges
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

// === Helpers ===

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

function isInsideExpandedParent(node: BoxCall, expandedNodes: Set<string>): boolean {
  return !!node.parent && expandedNodes.has(node.parent);
}

function getExpandedParent(node: BoxCall, expandedNodes: Set<string>): string | undefined {
  if (node.parent && expandedNodes.has(node.parent)) return node.parent;
  return undefined;
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
  expandedNodes: Set<string>,
): PromotedEdge[] {
  const result: PromotedEdge[] = [];
  for (const edge of edges) {
    let from = findVisibleAncestor(edge.from, visibleNodes, nodesById);
    let to = findVisibleAncestor(edge.to, visibleNodes, nodesById);
    if (!from || !to) continue;
    if (from === to) continue;

    const originalSource = nodesById.get(edge.from)!;
    const originalTarget = nodesById.get(edge.to)!;
    const outputResource = originalSource.outputs[edge.output]?.resourceId;
    const inputResource = originalTarget.inputs[edge.input]?.resourceId;

    let output = edge.output;
    let input = edge.input;

    // Remap output index when source was promoted to an ancestor
    if (from !== edge.from && outputResource) {
      const ancestor = nodesById.get(from)!;
      const newIndex = ancestor.outputs.findIndex(o => o.resourceId === outputResource);
      if (newIndex >= 0) output = newIndex;
      else continue;
    }

    // Remap input index when target was promoted to an ancestor
    if (to !== edge.to && inputResource) {
      const ancestor = nodesById.get(to)!;
      const newIndex = ancestor.inputs.findIndex(i => i.resourceId === inputResource);
      if (newIndex >= 0) input = newIndex;
      else continue;
    }

    // If source is an expanded group, re-route to the internal child that
    // produces the relevant output
    if (expandedNodes.has(from)) {
      const fromNode = nodesById.get(from)!;
      const resource = fromNode.outputs[output]?.resourceId;
      if (resource) {
        const internalProducer = findLastChildWithOutput(fromNode, resource, nodesById, visibleNodes);
        if (internalProducer) {
          const producerNode = nodesById.get(internalProducer)!;
          const producerOutputIdx = producerNode.outputs.findIndex(o => o.resourceId === resource);
          if (producerOutputIdx >= 0) {
            from = internalProducer;
            output = producerOutputIdx;
          }
        }
      }
    }

    // If target is an expanded group, re-route to the internal child that
    // consumes the relevant input
    if (expandedNodes.has(to)) {
      const toNode = nodesById.get(to)!;
      const resource = toNode.inputs[input]?.resourceId;
      if (resource) {
        const internalConsumer = findFirstChildWithInput(toNode, resource, nodesById, visibleNodes);
        if (internalConsumer) {
          const consumerNode = nodesById.get(internalConsumer)!;
          const consumerInputIdx = consumerNode.inputs.findIndex(i => i.resourceId === resource);
          if (consumerInputIdx >= 0) {
            to = internalConsumer;
            input = consumerInputIdx;
          }
        }
      }
    }

    result.push({ from, output, to, input });
  }
  return result;
}

function findLastChildWithOutput(
  parent: BoxCall,
  resourceId: string,
  nodesById: Map<string, BoxCall>,
  visibleNodes: Set<string>,
): string | null {
  let lastFound: string | null = null;
  for (const childId of parent.children) {
    if (!visibleNodes.has(childId)) continue;
    const child = nodesById.get(childId);
    if (child?.outputs.some((o) => o.resourceId === resourceId)) {
      lastFound = childId;
    }
  }
  return lastFound;
}

function findFirstChildWithInput(
  parent: BoxCall,
  resourceId: string,
  nodesById: Map<string, BoxCall>,
  visibleNodes: Set<string>,
): string | null {
  for (const childId of parent.children) {
    if (!visibleNodes.has(childId)) continue;
    const child = nodesById.get(childId);
    if (child?.inputs.some((i) => i.resourceId === resourceId)) {
      return childId;
    }
  }
  return null;
}

function computeLevels(nodes: BoxCall[], edges: { from: string; to: string }[]): Map<string, number> {
  const levels = new Map<string, number>();
  const incoming = new Map<string, Set<string>>();
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    incoming.set(node.id, new Set());
  }
  for (const edge of edges) {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
      incoming.get(edge.to)?.add(edge.from);
    }
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
      if (edge.from === current && nodeIds.has(edge.to)) {
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

function computeLevelsForChildren(
  childIds: string[],
  edges: PromotedEdge[],
  nodesById: Map<string, BoxCall>,
): Map<string, number> {
  const childSet = new Set(childIds);
  const childEdges = edges.filter((e) => childSet.has(e.from) && childSet.has(e.to));
  const childNodes = childIds.map((id) => nodesById.get(id)!).filter(Boolean);
  return computeLevels(childNodes, childEdges);
}

function countPrecedingAtLevel(
  nodeId: string,
  level: number,
  siblings: string[],
  levels: Map<string, number>,
): number {
  let count = 0;
  for (const id of siblings) {
    if (id === nodeId) break;
    if ((levels.get(id) ?? 0) === level) count++;
  }
  return count;
}

function countRowsPerLevel(levels: Map<string, number>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const level of levels.values()) {
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  return counts;
}
