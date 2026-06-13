import { Handle, Position, type NodeProps } from "@xyflow/react";

export type BoxNodeData = {
  label: string;
  resourceIds: string[];
  inputCount: number;
  outputCount: number;
  color: string;
  isGenerator: boolean;
  isComposite: boolean;
  isExpanded: boolean;
  childCount: number;
};

export function BoxNode({ data, selected }: NodeProps) {
  const { label, resourceIds, inputCount, outputCount, color, isGenerator, isComposite, isExpanded, childCount } =
    data as unknown as BoxNodeData;

  const inputHandles = Array.from({ length: inputCount }, (_, i) => {
    const position = inputCount === 1 ? 50 : 20 + (i * 60) / Math.max(inputCount - 1, 1);
    return (
      <Handle
        key={`in-${i}`}
        type="target"
        position={Position.Left}
        id={`in-${i}`}
        style={{ top: `${position}%`, width: 8, height: 8, background: "#555" }}
      />
    );
  });

  const outputHandles = Array.from({ length: outputCount }, (_, i) => {
    const position = outputCount === 1 ? 50 : 20 + (i * 60) / Math.max(outputCount - 1, 1);
    return (
      <Handle
        key={`out-${i}`}
        type="source"
        position={Position.Right}
        id={`out-${i}`}
        style={{ top: `${position}%`, width: 8, height: 8, background: color }}
      />
    );
  });

  const borderWidth = selected ? 3 : 2;
  const shadow = selected ? `0 0 0 2px ${color}40` : "0 1px 3px rgba(0,0,0,0.1)";
  const borderStyle = isComposite ? (isExpanded ? "dashed" : "solid") : "solid";

  return (
    <div
      style={{
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
      {resourceIds.length > 0 && (
        <div style={{ color: "#666", fontSize: 10, lineHeight: 1.4 }}>
          {resourceIds.slice(0, 3).map((id) => (
            <div key={id} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {id}
            </div>
          ))}
          {resourceIds.length > 3 && (
            <div style={{ color: "#999" }}>+{resourceIds.length - 3} more</div>
          )}
        </div>
      )}
      {outputHandles}
    </div>
  );
}
