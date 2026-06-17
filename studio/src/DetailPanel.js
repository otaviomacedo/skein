import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const SERVICE_COLORS = {
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
function getColor(type) {
    const prefix = type.split("::").slice(0, 2).join("::");
    return SERVICE_COLORS[prefix] ?? "#6B7280";
}
function shortType(type) {
    return type.split("::")[2] ?? type;
}
export function DetailPanel({ node, onClose }) {
    if (!node)
        return null;
    return (_jsxs("div", { style: {
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
        }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }, children: [_jsx("h3", { style: { margin: 0, fontSize: 14 }, children: node.box }), _jsx("button", { onClick: onClose, style: {
                            border: "none",
                            background: "#f3f4f6",
                            borderRadius: 4,
                            padding: "4px 8px",
                            cursor: "pointer",
                            fontSize: 12,
                        }, children: "Close" })] }), node.inputs.length > 0 && (_jsxs("div", { style: { marginBottom: 16 }, children: [_jsxs("h4", { style: { margin: "0 0 8px", fontSize: 11, textTransform: "uppercase", color: "#666" }, children: ["Inputs (", node.inputs.length, ")"] }), node.inputs.map((wire, i) => (_jsxs("div", { style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 0",
                            borderBottom: "1px solid #f3f4f6",
                        }, children: [_jsx("span", { style: {
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: getColor(wire.type),
                                    flexShrink: 0,
                                } }), _jsx("span", { style: { fontWeight: 600 }, children: wire.resourceId }), _jsx("span", { style: { color: "#999", marginLeft: "auto", fontSize: 10 }, children: shortType(wire.type) })] }, i)))] })), node.outputs.length > 0 && (_jsxs("div", { children: [_jsxs("h4", { style: { margin: "0 0 8px", fontSize: 11, textTransform: "uppercase", color: "#666" }, children: ["Outputs (", node.outputs.length, ")"] }), node.outputs.map((wire, i) => (_jsxs("div", { style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 0",
                            borderBottom: "1px solid #f3f4f6",
                        }, children: [_jsx("span", { style: {
                                    width: 8,
                                    height: 8,
                                    borderRadius: "50%",
                                    background: getColor(wire.type),
                                    flexShrink: 0,
                                } }), _jsx("span", { style: { fontWeight: 600 }, children: wire.resourceId }), _jsx("span", { style: { color: "#999", marginLeft: "auto", fontSize: 10 }, children: shortType(wire.type) })] }, i)))] }))] }));
}
