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
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
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
import { PropertiesPanel } from "./PropertiesPanel";
import { LibraryPanel } from "./LibraryPanel";
import { generateCode } from "./codegen";

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
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

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

  const [selectedFlowNode, setSelectedFlowNode] = useState<Node | null>(null);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length === 1) {
        const nodeId = selectedNodes[0].id;
        setSelectedNodeId(nodeId);
        const boxCall = graph ? (graph.nodes.find((n) => n.id === nodeId) ?? null) : null;
        setSelectedNode(boxCall);
        setSelectedFlowNode(selectedNodes[0]);
      } else {
        setSelectedNodeId(null);
        setSelectedNode(null);
        setSelectedFlowNode(null);
      }
    },
    [graph],
  );

  const onConfigUpdate = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const logicalId = typeof config.logicalId === "string" ? config.logicalId : undefined;
          const newData = { ...n.data, config, logicalId: logicalId || (n.data as any).logicalId };
          return { ...n, data: newData };
        }),
      );
    },
    [],
  );

  const { fitView, screenToFlowPosition } = useReactFlow();
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

  // Wire connections
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!connection.target || !connection.targetHandle) return false;
      // Check if the target port already has a connection (unless it's an array input)
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!targetNode) return false;
      const arrayInputs: number[] = (targetNode.data as any).arrayInputs ?? [];
      const portIndex = parseInt(connection.targetHandle?.replace("in-", "") ?? "0");
      if (arrayInputs.includes(portIndex)) return true; // Array inputs accept multiple
      // Non-array: check if already connected
      const existing = edges.find(
        (e) => e.target === connection.target && e.targetHandle === connection.targetHandle,
      );
      return !existing;
    },
    [nodes, edges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const edge: Edge = {
        id: `${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}-${Date.now()}`,
        source: connection.source!,
        sourceHandle: connection.sourceHandle,
        target: connection.target!,
        targetHandle: connection.targetHandle,
        type: "smoothstep",
        style: { stroke: "#6B7280", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6B7280", width: 12, height: 12 },
      };
      setEdges((eds) => addEdge(edge, eds));
    },
    [],
  );

  // Delete selected nodes/edges on Backspace/Delete
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Backspace" || event.key === "Delete") {
        setNodes((nds) => nds.filter((n) => !n.selected));
        setEdges((eds) => {
          const selectedNodeIds = new Set(
            nodes.filter((n) => n.selected).map((n) => n.id),
          );
          return eds.filter(
            (e) => !e.selected && !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target),
          );
        });
      }
    },
    [nodes],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const data = event.dataTransfer.getData("application/skein-box");
      if (!data) return;

      const box = JSON.parse(data);
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      const newNode: Node = {
        id: `draft-${Date.now()}`,
        position,
        data: {
          label: box.name,
          logicalId: undefined,
          resourceIds: box.outputs,
          inputNames: box.paramNames ?? box.inputs,
          inputCount: box.inputs.length,
          outputCount: box.outputs.length,
          color: "#6B7280",
          isGenerator: box.inputs.length === 0,
          isComposite: false,
          isExpanded: false,
          childCount: 0,
          faded: false,
          paramNames: box.paramNames,
          arrayInputs: box.arrayInputs,
        },
        type: "box",
      };

      setNodes((prev) => [...prev, newNode]);
    },
    [],
  );

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
      <LibraryPanel />
      <div style={{ position: "absolute", top: 0, left: 260, right: 0, bottom: 0 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={onNodeDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        deleteKeyCode={null}
        defaultEdgeOptions={{ type: "smoothstep" }}
        tabIndex={0}
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
            <button
              onClick={() => setGeneratedCode(generateCode(nodes, edges))}
              style={{ border: "1px solid #4f46e5", background: "#eef2ff", color: "#4f46e5", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
            >
              Generate Code
            </button>
          </div>
        </Panel>
      </ReactFlow>
      </div>
      <PropertiesPanel
        node={selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null}
        onUpdate={onConfigUpdate}
        onClose={() => { setSelectedFlowNode(null); setSelectedNode(null); setSelectedNodeId(null); }}
      />
      {generatedCode && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 260,
            right: 0,
            maxHeight: "40%",
            background: "#1e1e1e",
            color: "#d4d4d4",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            overflow: "auto",
            zIndex: 20,
            borderTop: "2px solid #4f46e5",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 16px", background: "#2d2d2d", borderBottom: "1px solid #3d3d3d" }}>
            <span style={{ fontWeight: 600, fontSize: 11, fontFamily: "'Inter', system-ui, sans-serif" }}>Generated Code</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => navigator.clipboard.writeText(generatedCode)}
                style={{ border: "1px solid #555", background: "#3d3d3d", color: "#d4d4d4", borderRadius: 3, padding: "2px 8px", cursor: "pointer", fontSize: 10 }}
              >
                Copy
              </button>
              <button
                onClick={() => setGeneratedCode(null)}
                style={{ border: "1px solid #555", background: "#3d3d3d", color: "#d4d4d4", borderRadius: 3, padding: "2px 8px", cursor: "pointer", fontSize: 10 }}
              >
                Close
              </button>
            </div>
          </div>
          <pre style={{ margin: 0, padding: 16, whiteSpace: "pre-wrap" }}>{generatedCode}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
