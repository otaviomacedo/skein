import { MarkerType } from "@xyflow/react";
const SERVICE_COLORS = {
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
function getColor(type) {
    const prefix = type.split("::").slice(0, 2).join("::");
    return SERVICE_COLORS[prefix] ?? "#6B7280";
}
function getPrimaryColor(node) {
    const primary = node.outputs[0] ?? node.inputs[0];
    return primary ? getColor(primary.type) : "#6B7280";
}
function shortType(type) {
    return type.split("::")[2] ?? type;
}
export function graphToFlow(graph, expandedNodes) {
    const nodes = [];
    const edges = [];
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
    // Determine which nodes are visible:
    // A node is visible if:
    // 1. It has no parent (top-level), OR
    // 2. Its parent is expanded (recursively up the chain)
    const visibleNodes = new Set();
    for (const node of graph.nodes) {
        if (isVisible(node, nodesById, expandedNodes)) {
            visibleNodes.add(node.id);
        }
    }
    // Promote edges: if source or target is hidden, reroute to nearest visible ancestor
    const promotedEdges = promoteEdges(graph.edges, visibleNodes, nodesById);
    const levels = computeLevels(graph.nodes.filter((n) => visibleNodes.has(n.id)), promotedEdges);
    const X_SPACING = 280;
    const Y_SPACING = 100;
    const levelCounts = new Map();
    for (const node of graph.nodes) {
        if (!visibleNodes.has(node.id))
            continue;
        const level = levels.get(node.id) ?? 0;
        const row = levelCounts.get(level) ?? 0;
        levelCounts.set(level, row + 1);
        const color = getPrimaryColor(node);
        const resourceIds = node.outputs.map((o) => o.resourceId);
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedNodes.has(node.id);
        const nodeData = {
            label: node.box,
            resourceIds,
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
    // Edges: render promoted edges (deduplicated, no self-loops)
    const edgeSeen = new Set();
    for (const edge of promotedEdges) {
        if (edge.from === edge.to)
            continue;
        const key = `${edge.from}-${edge.to}`;
        if (edgeSeen.has(key))
            continue;
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
            label: output ? shortType(output.type) : undefined,
            labelStyle: { fontSize: 9, fill: "#666" },
            labelBgStyle: { fill: "#fff", fillOpacity: 0.8 },
        });
    }
    return { nodes, edges };
}
function isVisible(node, nodesById, expandedNodes) {
    if (!node.parent)
        return true;
    const parent = nodesById.get(node.parent);
    if (!parent)
        return true;
    if (!expandedNodes.has(node.parent))
        return false;
    return isVisible(parent, nodesById, expandedNodes);
}
function findVisibleAncestor(nodeId, visibleNodes, nodesById) {
    if (visibleNodes.has(nodeId))
        return nodeId;
    const node = nodesById.get(nodeId);
    if (!node?.parent)
        return null;
    return findVisibleAncestor(node.parent, visibleNodes, nodesById);
}
function promoteEdges(edges, visibleNodes, nodesById) {
    const result = [];
    for (const edge of edges) {
        const from = findVisibleAncestor(edge.from, visibleNodes, nodesById);
        const to = findVisibleAncestor(edge.to, visibleNodes, nodesById);
        if (from && to) {
            result.push({ from, output: edge.output, to, input: edge.input });
        }
    }
    return result;
}
function computeLevels(nodes, edges) {
    const levels = new Map();
    const incoming = new Map();
    for (const node of nodes) {
        incoming.set(node.id, new Set());
    }
    for (const edge of edges) {
        incoming.get(edge.to)?.add(edge.from);
    }
    const queue = [];
    for (const [id, deps] of incoming) {
        if (deps.size === 0) {
            queue.push(id);
            levels.set(id, 0);
        }
    }
    while (queue.length > 0) {
        const current = queue.shift();
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
        if (!levels.has(node.id))
            levels.set(node.id, 0);
    }
    return levels;
}
