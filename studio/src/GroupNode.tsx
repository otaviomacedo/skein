import type { NodeProps } from "@xyflow/react";
import type { BoxNodeData } from "./BoxNode";

export function GroupNode({ id, data }: NodeProps) {
  const { label, logicalId, color, childCount } =
    data as unknown as BoxNodeData;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 12,
          right: 12,
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 9, background: `${color}20`, color, padding: "1px 4px", borderRadius: 3, fontWeight: 600 }}>
          ▼ {childCount}
        </span>
        <span style={{ fontWeight: 700, color: "#1a1a1a" }}>{label}</span>
        {logicalId && (
          <span style={{ color: "#666", fontSize: 10 }}>{logicalId}</span>
        )}
        <button
          className="collapse-btn"
          data-node-id={id}
          style={{
            marginLeft: "auto",
            border: `1px solid ${color}40`,
            background: "#fff",
            borderRadius: 4,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 10,
            color: "#666",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          Collapse
        </button>
      </div>
    </div>
  );
}
