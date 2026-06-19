import { useState } from "react";
import { catalog, type CatalogBox, type CatalogSection } from "./boxCatalog";

export function LibraryPanel() {
  const [search, setSearch] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (source: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const filteredCatalog = search.trim()
    ? catalog.map((section) => ({
        ...section,
        boxes: section.boxes.filter(
          (b) =>
            b.name.toLowerCase().includes(search.toLowerCase()) ||
            b.description.toLowerCase().includes(search.toLowerCase()) ||
            b.category.toLowerCase().includes(search.toLowerCase()),
        ),
      })).filter((s) => s.boxes.length > 0)
    : catalog;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 260,
        height: "100%",
        background: "#fff",
        borderRight: "1px solid #e5e7eb",
        overflow: "auto",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 11,
        zIndex: 10,
        boxShadow: "2px 0 8px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid #f3f4f6" }}>
        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>Box Library</div>
        <input
          type="text"
          placeholder="Search boxes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "5px 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 4,
            fontSize: 11,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {filteredCatalog.map((section) => (
        <SectionView
          key={section.source}
          section={section}
          collapsed={collapsedSections.has(section.source)}
          onToggle={() => toggleSection(section.source)}
        />
      ))}
    </div>
  );
}

function SectionView({
  section,
  collapsed,
  onToggle,
}: {
  section: CatalogSection;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          padding: "8px 12px",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 11,
          color: "#374151",
          background: "#f9fafb",
          borderBottom: "1px solid #f3f4f6",
          display: "flex",
          alignItems: "center",
          gap: 6,
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 9 }}>{collapsed ? "▶" : "▼"}</span>
        {section.source}
        <span style={{ color: "#9ca3af", fontWeight: 400, marginLeft: "auto" }}>
          {section.boxes.length}
        </span>
      </div>
      {!collapsed && (
        <div>
          {section.boxes.map((box) => (
            <BoxItem key={box.name} box={box} />
          ))}
        </div>
      )}
    </div>
  );
}

function BoxItem({ box }: { box: CatalogBox }) {
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData("application/skein-box", JSON.stringify(box));
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      style={{
        padding: "6px 12px",
        borderBottom: "1px solid #f9fafb",
        cursor: "grab",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ fontWeight: 600, color: "#1a1a1a" }}>{box.name}</div>
      <div style={{ color: "#6b7280", fontSize: 10, marginTop: 1 }}>{box.description}</div>
      <div style={{ display: "flex", gap: 4, marginTop: 3, flexWrap: "wrap" }}>
        {box.inputs.map((inp, i) => (
          <span
            key={i}
            style={{
              fontSize: 9,
              background: "#e0e7ff",
              color: "#4338ca",
              padding: "0 4px",
              borderRadius: 2,
            }}
          >
            {inp}
          </span>
        ))}
        {box.inputs.length > 0 && box.outputs.length > 0 && (
          <span style={{ fontSize: 9, color: "#9ca3af" }}>→</span>
        )}
        {box.outputs.map((out, i) => (
          <span
            key={i}
            style={{
              fontSize: 9,
              background: "#dcfce7",
              color: "#166534",
              padding: "0 4px",
              borderRadius: 2,
            }}
          >
            {out}
          </span>
        ))}
      </div>
    </div>
  );
}
