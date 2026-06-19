import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useState } from "react";

export type BoxNodeData = {
  label: string;
  logicalId?: string;
  resourceIds: string[];
  inputNames: string[];
  inputCount: number;
  outputCount: number;
  color: string;
  isGenerator: boolean;
  isComposite: boolean;
  isExpanded: boolean;
  childCount: number;
  faded?: boolean;
};

function PortWithTooltip({
  type,
  position,
  id,
  topPercent,
  color,
  name,
}: {
  type: "source" | "target";
  position: typeof Position.Left | typeof Position.Right;
  id: string;
  topPercent: number;
  color: string;
  name?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const isLeft = position === Position.Left;

  return (
    <>
      <Handle
        type={type}
        position={position}
        id={id}
        style={{ top: `${topPercent}%`, width: 8, height: 8, background: color }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {hovered && name && (
        <div
          style={{
            position: "absolute",
            top: `${topPercent}%`,
            [isLeft ? "left" : "right"]: -4,
            transform: `translate(${isLeft ? "-100%" : "100%"}, -50%)`,
            background: "#1a1a1a",
            color: "#fff",
            fontSize: 9,
            padding: "2px 6px",
            borderRadius: 3,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 100,
          }}
        >
          {name}
        </div>
      )}
    </>
  );
}

export function BoxNode({ data, selected }: NodeProps) {
  const { label, logicalId, resourceIds, inputNames, inputCount, outputCount, color, isGenerator, isComposite, isExpanded, childCount, faded } =
    data as unknown as BoxNodeData;

  const inputHandles = Array.from({ length: inputCount }, (_, i) => {
    const position = inputCount === 1 ? 50 : 20 + (i * 60) / Math.max(inputCount - 1, 1);
    return (
      <PortWithTooltip
        key={`in-${i}`}
        type="target"
        position={Position.Left}
        id={`in-${i}`}
        topPercent={position}
        color="#555"
        name={inputNames[i]}
      />
    );
  });

  const outputHandles = Array.from({ length: outputCount }, (_, i) => {
    const position = outputCount === 1 ? 50 : 20 + (i * 60) / Math.max(outputCount - 1, 1);
    return (
      <PortWithTooltip
        key={`out-${i}`}
        type="source"
        position={Position.Right}
        id={`out-${i}`}
        topPercent={position}
        color={color}
        name={resourceIds[i]}
      />
    );
  });

  const borderWidth = selected ? 3 : 2;
  const shadow = selected ? `0 0 0 2px ${color}40` : "0 1px 3px rgba(0,0,0,0.1)";
  const borderStyle = isComposite ? (isExpanded ? "dashed" : "solid") : "solid";

  return (
    <div
      style={{
        position: "relative",
        background: "#fff",
        border: `${borderWidth}px ${borderStyle} ${color}`,
        borderRadius: isComposite ? 12 : 8,
        padding: "10px 14px",
        minWidth: 130,
        maxWidth: 200,
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 11,
        boxShadow: shadow,
        transition: "box-shadow 0.15s, opacity 0.2s",
        opacity: faded ? 0.2 : 1,
      }}
    >
      {inputHandles}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {isGenerator && (
          <span style={{ fontSize: 9, background: `${color}20`, color, padding: "1px 4px", borderRadius: 3, fontWeight: 600 }}>
            GEN
          </span>
        )}
        {isComposite && (
          <span style={{ fontSize: 9, background: `${color}20`, color, padding: "1px 4px", borderRadius: 3, fontWeight: 600 }}>
            {isExpanded ? "▼" : "▶"} {childCount}
          </span>
        )}
        <span style={{ fontWeight: 700, color: "#1a1a1a" }}>{label}</span>
      </div>
      {logicalId && (
        <div style={{ color: "#666", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {logicalId}
        </div>
      )}
      {outputHandles}
    </div>
  );
}
