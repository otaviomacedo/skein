import { useState } from "react";

export type PropValue = string | number | boolean | null | PropValue[] | { [key: string]: PropValue };

type Props = {
  value: PropValue;
  onChange: (value: PropValue) => void;
  depth?: number;
};

export function PropertyTree({ value, onChange, depth = 0 }: Props) {
  if (value === null || value === undefined) {
    return <InlineEditor value="" onChange={(v) => onChange(v || null)} placeholder="null" />;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <InlineEditor value={String(value)} onChange={(v) => onChange(parseValue(v))} />;
  }

  if (Array.isArray(value)) {
    return <ArrayEditor value={value} onChange={onChange} depth={depth} />;
  }

  if (typeof value === "object") {
    return <ObjectEditor value={value as Record<string, PropValue>} onChange={onChange} depth={depth} />;
  }

  return null;
}

function ObjectEditor({
  value,
  onChange,
  depth,
}: {
  value: Record<string, PropValue>;
  onChange: (value: PropValue) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(depth > 1);
  const [newKey, setNewKey] = useState("");

  const entries = Object.entries(value);

  const updateKey = (key: string, newVal: PropValue) => {
    onChange({ ...value, [key]: newVal });
  };

  const removeKey = (key: string) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };

  const addKey = () => {
    if (newKey.trim() && !(newKey in value)) {
      onChange({ ...value, [newKey.trim()]: "" });
      setNewKey("");
    }
  };

  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none" }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontSize: 9, color: "#666" }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{ fontSize: 10, color: "#999" }}>{`{${entries.length}}`}</span>
      </div>

      {!collapsed && (
        <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: 8, marginTop: 2 }}>
          {entries.map(([key, val]) => (
            <div key={key} style={{ marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: "#374151", minWidth: 60 }}>{key}</span>
                <button
                  onClick={() => removeKey(key)}
                  style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 10, padding: 0 }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
              <PropertyTree value={val} onChange={(v) => updateKey(key, v)} depth={depth + 1} />
            </div>
          ))}

          {/* Add new key */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addKey()}
              placeholder="new key"
              style={{ width: 80, fontSize: 10, padding: "2px 4px", border: "1px solid #e5e7eb", borderRadius: 3 }}
            />
            <button
              onClick={addKey}
              style={{ fontSize: 10, border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ArrayEditor({
  value,
  onChange,
  depth,
}: {
  value: PropValue[];
  onChange: (value: PropValue) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(depth > 1);

  const updateIndex = (i: number, newVal: PropValue) => {
    const next = [...value];
    next[i] = newVal;
    onChange(next);
  };

  const removeIndex = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  const addItem = () => {
    onChange([...value, ""]);
  };

  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none" }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontSize: 9, color: "#666" }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{ fontSize: 10, color: "#999" }}>{`[${value.length}]`}</span>
      </div>

      {!collapsed && (
        <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: 8, marginTop: 2 }}>
          {value.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#999", minWidth: 16, paddingTop: 3 }}>{i}</span>
              <div style={{ flex: 1 }}>
                <PropertyTree value={item} onChange={(v) => updateIndex(i, v)} depth={depth + 1} />
              </div>
              <button
                onClick={() => removeIndex(i)}
                style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 10, padding: 0 }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={addItem}
            style={{ fontSize: 10, border: "1px solid #e5e7eb", background: "#f9fafb", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}
          >
            + item
          </button>
        </div>
      )}
    </div>
  );
}

function InlineEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%",
        padding: "3px 6px",
        border: "1px solid #e5e7eb",
        borderRadius: 3,
        fontSize: 10,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        outline: "none",
        boxSizing: "border-box",
      }}
    />
  );
}

function parseValue(str: string): PropValue {
  if (str === "true") return true;
  if (str === "false") return false;
  if (str === "null" || str === "") return null;
  const num = Number(str);
  if (!isNaN(num) && str.trim() !== "") return num;
  return str;
}
