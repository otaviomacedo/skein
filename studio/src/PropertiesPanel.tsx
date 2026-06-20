import { useState, useEffect } from "react";
import type { Node } from "@xyflow/react";
import type { BoxNodeData } from "./BoxNode";
import { PropertyTree, type PropValue } from "./PropertyTree";
import { catalog } from "./boxCatalog";

const catalogLookup = new Map(
  catalog.flatMap((section) => section.boxes.map((b) => [b.name, b])),
);

const RESOURCE_TYPES = new Set([
  "Table", "Queue", "Topic", "Function", "Function[]", "VPC",
  "Subnets", "Subnet", "Bucket", "StateMachine", "Alarm", "Asset",
]);

type Props = {
  node: Node | null;
  onUpdate: (nodeId: string, props: Record<string, PropValue>) => void;
  onClose: () => void;
};

export function PropertiesPanel({ node, onUpdate, onClose }: Props) {
  const [props, setProps] = useState<Record<string, PropValue>>({});

  useEffect(() => {
    if (node) {
      setProps((node.data as any).config ?? {});
    }
  }, [node?.id]);

  if (!node) return null;

  const data = node.data as unknown as BoxNodeData;
  const isDraft = node.id.startsWith("draft-");
  const catalogEntry = catalogLookup.get(data.label);
  const paramNames = (data as any).paramNames ?? catalogEntry?.paramNames ?? [];
  const inputs = catalogEntry?.inputs ?? [];

  // Split params into resource wires vs configurable properties
  const wireParams: { name: string; type: string; index: number }[] = [];
  const configParams: { name: string; type: string; index: number }[] = [];

  // LogicalId is always configurable for named boxes
  const hasLogicalId = data.logicalId !== undefined || data.isGenerator || (catalogEntry && inputs.length > 0);

  for (let i = 0; i < inputs.length; i++) {
    const name = paramNames[i] ?? `param${i}`;
    if (RESOURCE_TYPES.has(inputs[i])) {
      wireParams.push({ name, type: inputs[i], index: i });
    } else {
      configParams.push({ name, type: inputs[i], index: i });
    }
  }

  const handleChange = (key: string, value: PropValue) => {
    const next = { ...props, [key]: value };
    setProps(next);
    onUpdate(node.id, next);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 320,
        height: "100%",
        background: "#fff",
        borderLeft: "1px solid #e5e7eb",
        overflow: "auto",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 12,
        zIndex: 10,
        boxShadow: "-2px 0 8px rgba(0,0,0,0.05)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 10px", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14 }}>{data.label}</h3>
          {(data.logicalId || props.logicalId) && (
            <span style={{ color: "#666", fontSize: 11 }}>{String(props.logicalId || data.logicalId)}</span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ border: "none", background: "#f3f4f6", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}
        >
          Close
        </button>
      </div>

      {/* Logical ID */}
      {hasLogicalId && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
          <label style={{ display: "block", fontSize: 10, color: "#374151", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Logical ID
          </label>
          <input
            type="text"
            value={String(props.logicalId ?? data.logicalId ?? "")}
            onChange={(e) => handleChange("logicalId", e.target.value)}
            placeholder="e.g., Orders, Ecommerce"
            readOnly={!isDraft}
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "1px solid #e5e7eb",
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              outline: "none",
              boxSizing: "border-box",
              background: isDraft ? "#fff" : "#f9fafb",
              color: isDraft ? "#1a1a1a" : "#666",
            }}
          />
        </div>
      )}

      {/* Configuration properties (non-resource params) — editable for draft nodes */}
      {isDraft && configParams.length > 0 && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
          <h4 style={{ margin: "0 0 10px", fontSize: 10, textTransform: "uppercase", color: "#666", letterSpacing: "0.5px", fontWeight: 600 }}>
            Configuration
          </h4>

          {configParams.map((param) => {
            const template = catalogEntry?.configTemplate ?? {};
            const defaultValue = props[param.name] ?? template ?? (param.type === "props" ? {} : "");
            return (
              <div key={param.name} style={{ marginBottom: 10 }}>
                <label style={{ display: "block", fontSize: 10, color: "#374151", marginBottom: 3, fontWeight: 500 }}>
                  {param.name}
                  <span style={{ color: "#9ca3af", fontWeight: 400, marginLeft: 4 }}>{param.type}</span>
                </label>
                <PropertyTree
                  value={defaultValue as any}
                  onChange={(v) => handleChange(param.name, v)}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Summary for synth-graph nodes */}
      {!isDraft && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 10, textTransform: "uppercase", color: "#666", letterSpacing: "0.5px", fontWeight: 600 }}>
            Outputs
          </h4>
          {data.resourceIds && data.resourceIds.length > 0 ? (
            data.resourceIds.map((id, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid #f9fafb" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: data.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 500, fontSize: 11 }}>{id}</span>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 10, color: "#9ca3af", fontStyle: "italic", margin: 0 }}>No outputs</p>
          )}

          {data.inputNames && data.inputNames.length > 0 && (
            <>
              <h4 style={{ margin: "12px 0 8px", fontSize: 10, textTransform: "uppercase", color: "#666", letterSpacing: "0.5px", fontWeight: 600 }}>
                Inputs
              </h4>
              {data.inputNames.map((name, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid #f9fafb" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#555", flexShrink: 0 }} />
                  <span style={{ fontWeight: 500, fontSize: 11 }}>{name}</span>
                </div>
              ))}
            </>
          )}

          <p style={{ fontSize: 10, color: "#9ca3af", margin: "12px 0 0", fontStyle: "italic" }}>
            Properties are defined in source code. Edit the .ts file to change configuration.
          </p>
        </div>
      )}

      {/* Resource wire connections */}
      {wireParams.length > 0 && (
        <div style={{ padding: "12px 16px" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 10, textTransform: "uppercase", color: "#666", letterSpacing: "0.5px", fontWeight: 600 }}>
            Wire Inputs
          </h4>
          {wireParams.map((param, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f9fafb" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6B7280", flexShrink: 0 }} />
              <span style={{ fontWeight: 500, fontSize: 11 }}>{param.name}</span>
              <span style={{ color: "#9ca3af", marginLeft: "auto", fontSize: 10 }}>{param.type}</span>
            </div>
          ))}
          <p style={{ fontSize: 10, color: "#9ca3af", margin: "8px 0 0", fontStyle: "italic" }}>
            Connect these by drawing wires in the diagram.
          </p>
        </div>
      )}
    </div>
  );
}
