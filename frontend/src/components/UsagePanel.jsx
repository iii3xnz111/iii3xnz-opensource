import React from "react";

function Bar({ label, current, max }) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  const near = pct >= 80;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: near ? "var(--danger)" : "var(--text-muted)" }}>
          {current} / {max >= 9999 ? "∞" : max}
        </span>
      </div>
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: near ? "var(--danger)" : "var(--success)", transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

export default function UsagePanel({ usage }) {
  if (!usage) return null;
  const executionLabel = usage.executionWindow === "month" ? "Executions this month" : "Executions today";
  return (
    <div className="surface" style={{ margin: "0 0 20px", padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 650 }}>Workspace usage</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "capitalize" }}>{usage.plan} plan</span>
      </div>
      <Bar label={executionLabel} current={usage.executions ?? usage.executionsToday} max={usage.maxExecutions ?? usage.maxExecutionsPerDay} />
      <Bar label="Workflows" current={usage.workflowCount} max={usage.maxWorkflows} />
    </div>
  );
}
