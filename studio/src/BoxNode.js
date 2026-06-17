import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Handle, Position } from "@xyflow/react";
export function BoxNode({ data, selected }) {
    const { label, resourceIds, inputCount, outputCount, color, isGenerator, isComposite, isExpanded, childCount } = data;
    const inputHandles = Array.from({ length: inputCount }, (_, i) => {
        const position = inputCount === 1 ? 50 : 20 + (i * 60) / Math.max(inputCount - 1, 1);
        return (_jsx(Handle, { type: "target", position: Position.Left, id: `in-${i}`, style: { top: `${position}%`, width: 8, height: 8, background: "#555" } }, `in-${i}`));
    });
    const outputHandles = Array.from({ length: outputCount }, (_, i) => {
        const position = outputCount === 1 ? 50 : 20 + (i * 60) / Math.max(outputCount - 1, 1);
        return (_jsx(Handle, { type: "source", position: Position.Right, id: `out-${i}`, style: { top: `${position}%`, width: 8, height: 8, background: color } }, `out-${i}`));
    });
    const borderWidth = selected ? 3 : 2;
    const shadow = selected ? `0 0 0 2px ${color}40` : "0 1px 3px rgba(0,0,0,0.1)";
    const borderStyle = isComposite ? (isExpanded ? "dashed" : "solid") : "solid";
    return (_jsxs("div", { style: {
            background: "#fff",
            border: `${borderWidth}px ${borderStyle} ${color}`,
            borderRadius: isComposite ? 12 : 8,
            padding: "10px 14px",
            minWidth: 130,
            maxWidth: 200,
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 11,
            boxShadow: shadow,
            transition: "box-shadow 0.15s",
        }, children: [inputHandles, _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }, children: [isGenerator && (_jsx("span", { style: { fontSize: 9, background: `${color}20`, color, padding: "1px 4px", borderRadius: 3, fontWeight: 600 }, children: "GEN" })), isComposite && (_jsxs("span", { style: { fontSize: 9, background: `${color}20`, color, padding: "1px 4px", borderRadius: 3, fontWeight: 600 }, children: [isExpanded ? "▼" : "▶", " ", childCount] })), _jsx("span", { style: { fontWeight: 700, color: "#1a1a1a" }, children: label })] }), resourceIds.length > 0 && (_jsxs("div", { style: { color: "#666", fontSize: 10, lineHeight: 1.4 }, children: [resourceIds.slice(0, 3).map((id) => (_jsx("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: id }, id))), resourceIds.length > 3 && (_jsxs("div", { style: { color: "#999" }, children: ["+", resourceIds.length - 3, " more"] }))] })), outputHandles] }));
}
