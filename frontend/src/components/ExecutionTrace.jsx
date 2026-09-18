import React, { useState } from "react";
import { CheckCircle2, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import { NODE_REGISTRY } from "../nodeRegistry.js";

function Step({ step }) {
  const [open, setOpen] = useState(false);
  const meta = NODE_REGISTRY[step.type] || {};
  const Icon = meta.icon;
  const failed = !!step.error;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 6, overflow: "hidden" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", background: failed ? "#3a1414" : "var(--surface-3)" }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {failed ? <XCircle size={15} color="#ef4444" /> : <CheckCircle2 size={15} color="#22c55e" />}
        {Icon && <Icon size={14} color={meta.color} />}
        <span style={{ fontSize: 12, fontWeight: 600 }}>{meta.label || step.type}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}>{step.durationMs}ms</span>
      </div>
      {open && (
        <div style={{ padding: "8px 10px", fontSize: 11, background: "var(--surface)" }}>
          {failed ? (
            <div style={{ color: "#ef4444" }}>{step.error}</div>
          ) : (
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--text)" }}>
              {JSON.stringify(step.output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function ExecutionTrace({ log }) {
  if (!log || log.length === 0) return <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No steps recorded.</p>;
  return (
    <div>
      {log.map((step, i) => (
        <Step key={i} step={step} />
      ))}
    </div>
  );
}
