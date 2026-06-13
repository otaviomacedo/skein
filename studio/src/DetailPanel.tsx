import { BoxCall } from "./types";

type Props = {
  node: BoxCall | null;
  onClose: () => void;
};

const SERVICE_COLORS: Record<string, string> = {
  "AWS::S3": "#3F8624",
  "AWS::Lambda": "#D86613",
  "AWS::IAM": "#DD344C",
  "AWS::CloudFront": "#8C4FFF",
  "AWS::DynamoDB": "#2E73B8",
  "AWS::SQS": "#D6551D",
  "AWS::SNS": "#A1325C",
  "AWS::Events": "#E7A33E",
  "AWS::CloudWatch": "#E7157B",
};

function getColor(type: string): string {
  const prefix = type.split("::").slice(0, 2).join("::");
  return SERVICE_COLORS[prefix] ?? "#6B7280";
}

function shortType(type: string): string {
  return type.split("::")[2] ?? type;
}

export function DetailPanel({ node, onClose }: Props) {
  if (!node) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 300,
        height: "100%",
        background: "#fff",
        borderLeft: "1px solid #e5e7eb",
        padding: 20,
        overflow: "auto",
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 12,
        zIndex: 10,
        boxShadow: "-2px 0 8px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>{node.box}</h3>
        <button
          onClick={onClose}
          style={{
            border: "none",
            background: "#f3f4f6",
            borderRadius: 4,
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Close
        </button>
      </div>

      {node.inputs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 11, textTransform: "uppercase", color: "#666" }}>
            Inputs ({node.inputs.length})
          </h4>
          {node.inputs.map((wire, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 0",
                borderBottom: "1px solid #f3f4f6",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: getColor(wire.type),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 600 }}>{wire.resourceId}</span>
              <span style={{ color: "#999", marginLeft: "auto", fontSize: 10 }}>
                {shortType(wire.type)}
              </span>
            </div>
          ))}
        </div>
      )}

      {node.outputs.length > 0 && (
        <div>
          <h4 style={{ margin: "0 0 8px", fontSize: 11, textTransform: "uppercase", color: "#666" }}>
            Outputs ({node.outputs.length})
          </h4>
          {node.outputs.map((wire, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 0",
                borderBottom: "1px solid #f3f4f6",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: getColor(wire.type),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 600 }}>{wire.resourceId}</span>
              <span style={{ color: "#999", marginLeft: "auto", fontSize: 10 }}>
                {shortType(wire.type)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
