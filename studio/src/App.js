import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from "react";
import { ReactFlow, Background, Controls, MiniMap, Panel, useNodesState, useEdgesState, BackgroundVariant, } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { graphToFlow } from "./graphToFlow";
import { BoxNode } from "./BoxNode";
import { DetailPanel } from "./DetailPanel";
const nodeTypes = { box: BoxNode };
function App() {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [graph, setGraph] = useState(null);
    const [expandedNodes, setExpandedNodes] = useState(new Set());
    const [selectedNode, setSelectedNode] = useState(null);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);
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
    async function loadGraph() {
        try {
            const res = await fetch("/graph.json");
            if (!res.ok) {
                setError("No graph.json found. Run `skein synth` first.");
                return;
            }
            const graphData = await res.json();
            setGraph(graphData);
            const resourceCount = new Set(graphData.nodes.flatMap((n) => n.outputs.map((o) => o.resourceId))).size;
            setStats({ nodes: graphData.nodes.length, edges: graphData.edges.length, resources: resourceCount });
        }
        catch (e) {
            setError(`Failed to load graph: ${e.message}`);
        }
    }
    const onSelectionChange = useCallback(({ nodes: selectedNodes }) => {
        if (selectedNodes.length === 1 && graph) {
            const nodeId = selectedNodes[0].id;
            const boxCall = graph.nodes.find((n) => n.id === nodeId) ?? null;
            setSelectedNode(boxCall);
        }
        else {
            setSelectedNode(null);
        }
    }, [graph]);
    const onNodeDoubleClick = useCallback((_event, node) => {
        if (!graph)
            return;
        const boxCall = graph.nodes.find((n) => n.id === node.id);
        if (!boxCall || boxCall.children.length === 0)
            return;
        setExpandedNodes((prev) => {
            const next = new Set(prev);
            if (next.has(node.id)) {
                next.delete(node.id);
            }
            else {
                next.add(node.id);
            }
            return next;
        });
    }, [graph]);
    const collapseAll = useCallback(() => setExpandedNodes(new Set()), []);
    const expandAll = useCallback(() => {
        if (!graph)
            return;
        const all = new Set(graph.nodes.filter((n) => n.children.length > 0).map((n) => n.id));
        setExpandedNodes(all);
    }, [graph]);
    if (error) {
        return (_jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: "'Inter', system-ui, sans-serif" }, children: _jsxs("div", { style: { textAlign: "center" }, children: [_jsx("h2", { style: { color: "#1a1a1a", marginBottom: 8 }, children: "Skein Studio" }), _jsx("p", { style: { color: "#666" }, children: error })] }) }));
    }
    return (_jsxs("div", { style: { width: "100%", height: "100%", position: "relative" }, children: [_jsxs(ReactFlow, { nodes: nodes, edges: edges, onNodesChange: onNodesChange, onEdgesChange: onEdgesChange, onSelectionChange: onSelectionChange, onNodeDoubleClick: onNodeDoubleClick, nodeTypes: nodeTypes, fitView: true, fitViewOptions: { padding: 0.2 }, minZoom: 0.2, maxZoom: 2, defaultEdgeOptions: { type: "smoothstep" }, children: [_jsx(Background, { variant: BackgroundVariant.Dots, gap: 20, size: 1, color: "#e5e7eb" }), _jsx(Controls, { showInteractive: false }), _jsx(MiniMap, { nodeColor: (node) => node.data.color ?? "#6B7280", maskColor: "rgba(255,255,255,0.7)", style: { border: "1px solid #e5e7eb" } }), _jsx(Panel, { position: "top-left", children: _jsxs("div", { style: {
                                background: "#fff",
                                padding: "8px 14px",
                                borderRadius: 8,
                                boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
                                fontFamily: "'Inter', system-ui, sans-serif",
                                fontSize: 12,
                                display: "flex",
                                gap: 16,
                                alignItems: "center",
                            }, children: [_jsx("span", { style: { fontWeight: 700, fontSize: 13 }, children: "Skein Studio" }), stats && (_jsxs("span", { style: { color: "#666" }, children: [stats.resources, " resources \u00B7 ", stats.nodes, " boxes \u00B7 ", stats.edges, " wires"] })), _jsx("button", { onClick: expandAll, style: { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }, children: "Expand all" }), _jsx("button", { onClick: collapseAll, style: { border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }, children: "Collapse all" })] }) })] }), _jsx(DetailPanel, { node: selectedNode, onClose: () => setSelectedNode(null) })] }));
}
export default App;
