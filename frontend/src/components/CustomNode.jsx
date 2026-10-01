import React from "react";
import { Handle, Position } from "reactflow";
import { NODE_REGISTRY } from "../nodeRegistry.js";

export default function CustomNode({ data, selected }) {
  const meta = NODE_REGISTRY[data.nodeType] || {};
  const Icon = meta.icon;
  const isIf = data.nodeType === "ifCondition";
  const isTrigger = meta.category === "Triggers";

  return (
    <div
      style={{
        borderRadius: 10,
        border: `2px solid ${selected ? meta.color || "#555" : "var(--border)"}`,
        background: "var(--surface-2)",
        boxShadow: selected ? "0 0 0 3px rgba(99,102,241,0.25)" : "0 1px 3px rgba(0,0,0,0.4)",
        minWidth: 170,
        overflow: "hidden",
      }}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} style={{ background: "#94a3b8" }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: `${meta.color}25` }}>
        {Icon && <Icon size={16} color={meta.color} />}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{meta.label || data.nodeType}</span>
      </div>
      {data.subtitle && (
        <div style={{ padding: "4px 12px 8px", fontSize: 10, color: "var(--text-muted)", wordBreak: "break-all" }}>
          {data.subtitle}
        </div>
      )}

      {isIf ? (
        <>
          <Handle type="source" position={Position.Right} id="true" style={{ top: "35%", background: "#22c55e" }} />
          <Handle type="source" position={Position.Right} id="false" style={{ top: "70%", background: "#ef4444" }} />
          <div style={{ position: "absolute", right: -28, top: "30%", fontSize: 9, color: "#22c55e" }}>true</div>
          <div style={{ position: "absolute", right: -30, top: "65%", fontSize: 9, color: "#ef4444" }}>false</div>
        </>
      ) : (
        <Handle type="source" position={Position.Right} style={{ background: "#94a3b8" }} />
      )}
    </div>
  );
}
