import { useState, useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
  type NodeMouseHandler,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphIR, BoxCall } from "./types";
import { graphToFlow } from "./graphToFlow";
import { BoxNode } from "./BoxNode";
import { GroupNode } from "./GroupNode";
import { DetailPanel } from "./DetailPanel";

const nodeTypes = { box: BoxNode, group: GroupNode };

function getConnectedNodeIds(selectedId: string | null, edges: Edge[]): Set<string> | null {
  if (!selectedId) return null;
  const connected = new Set<string>([selectedId]);
  for (const edge of edges) {
    if (edge.source === selectedId) connected.add(edge.target);
    if (edge.target === selectedId) connected.add(edge.source);
  }
  return connected;
}

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [graph, setGraph] = useState<GraphIR | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<BoxCall | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ nodes: number; edges: number; resources: number } | null>(null);

  useEffect(() => {
    loadGraph();
  }, []);

  useEffect(() => {
    if (graph) {
      const { nodes: flowNodes, edges: flowEdges } = graphToFlow(graph, expandedNodes);
      setNodes(flowNodes);
      setEdges(flowEdges);
    }
  }, [graph, expandedNodes]);

  // Apply fading when selection changes (without rebuilding the graph)
  useEffect(() => {
    setEdges((currentEdges) => {
      const highlightedIds = getConnectedNodeIds(selectedNodeId, currentEdges);
      setNodes((currentNodes) =>
        currentNodes.map((n) => ({
          ...n,
          data: { ...n.data, faded: highlightedIds !== null && !highlightedIds.has(n.id) },
        })),
      );
      return currentEdges.map((e) => ({
        ...e,
        style: {
          ...e.style,
          opacity: highlightedIds !== null && !(highlightedIds.has(e.source) && highlightedIds.has(e.target)) ? 0.15 : 1,
        },
      }));
    });
  }, [selectedNodeId]);

  async function loadGraph() {
    try {
      const res = await fetch("/graph.json");
      if (!res.ok) {
        setError("No graph.json found. Run `skein synth` first.");
        return;
      }
      const graphData: GraphIR = await res.json();
      setGraph(graphData);

      const resourceCount = new Set(
        graphData.nodes.flatMap((n) => n.outputs.map((o) => o.resourceId)),
      ).size;
      setStats({ nodes: graphData.nodes.length, edges: graphData.edges.length, resources: resourceCount });
    } catch (e) {
      setError(`Failed to load graph: ${(e as Error).message}`);
    }
  }

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length === 1 && graph) {
        const nodeId = selectedNodes[0].id;
        setSelectedNodeId(nodeId);
        const boxCall = graph.nodes.find((n) => n.id === nodeId) ?? null;
        setSelectedNode(boxCall);
      } else {
        setSelectedNodeId(null);
        setSelectedNode(null);
      }
    },
    [graph],
  );

  const { fitView } = useReactFlow();
  const pendingFocusNode = useRef<string | null>(null);

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (!graph) return;
      const boxCall = graph.nodes.find((n) => n.id === node.id);
      if (!boxCall || boxCall.children.length === 0) return;

      pendingFocusNode.current = node.id;
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
    },
    [graph],
  );

  // Center on the expanded/collapsed node after layout updates
  useEffect(() => {
    if (pendingFocusNode.current && nodes.length > 0) {
      const nodeId = pendingFocusNode.current;
      pendingFocusNode.current = null;
      // Small delay to let React Flow measure the nodes
      setTimeout(() => {
        fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.3 });
      }, 50);
    }
  }, [nodes, fitView]);

  // Handle collapse button clicks from GroupNode
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const btn = (e.target as HTMLElement).closest(".collapse-btn") as HTMLElement | null;
      if (!btn) return;
      const nodeId = btn.dataset.nodeId;
      if (!nodeId) return;
      pendingFocusNode.current = nodeId;
      setExpandedNodes((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  const collapseAll = useCallback(() => setExpandedNodes(new Set()), []);
  const expandAll = useCallback(() => {
    if (!graph) return;
    const all = new Set(graph.nodes.filter((n) => n.children.length > 0).map((n) => n.id));
    setExpandedNodes(all);
  }, [graph]);

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ color: "#1a1a1a", marginBottom: 8 }}>Skein Studio</h2>
          <p style={{ color: "#666" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => (node.data as any).color ?? "#6B7280"}
          maskColor="rgba(255,255,255,0.7)"
          style={{ border: "1px solid #e5e7eb" }}
        />
        <Panel position="top-left">
          <div
            style={{
              background: "#fff",
              padding: "8px 14px",
              borderRadius: 8,
              boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: 12,
              display: "flex",
              gap: 16,
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13 }}>Skein Studio</span>
            {stats && (
              <span style={{ color: "#666" }}>
                {stats.resources} resources &middot; {stats.nodes} boxes &middot; {stats.edges} wires
              </span>
            )}
            <button
              onClick={expandAll}
              style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}
            >
              Expand all
            </button>
            <button
              onClick={collapseAll}
              style={{ border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}
            >
              Collapse all
            </button>
          </div>
        </Panel>
      </ReactFlow>
      <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
}

export default App;
