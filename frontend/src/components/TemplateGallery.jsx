import React from "react";

const TEMPLATES = [
  {
    name: "Webhook → API call",
    description: "Receive a webhook, then forward the data to another API.",
    definition: {
      nodes: [
        { id: "t1", type: "default", data: { nodeType: "webhookTrigger", config: {} }, position: { x: 60, y: 100 } },
        { id: "t2", type: "default", data: { nodeType: "httpRequest", config: { method: "POST", url: "https://example.com/api", body: "{{input.body}}" } }, position: { x: 320, y: 100 } },
      ],
      edges: [{ id: "e1", source: "t1", target: "t2" }],
    },
  },
  {
    name: "Scheduled check with branch",
    description: "Poll an API on a schedule and branch based on the response.",
    definition: {
      nodes: [
        { id: "s1", type: "default", data: { nodeType: "scheduleTrigger", config: { cron: "*/15 * * * *" } }, position: { x: 40, y: 100 } },
        { id: "s2", type: "default", data: { nodeType: "httpRequest", config: { method: "GET", url: "https://example.com/status" } }, position: { x: 300, y: 100 } },
        { id: "s3", type: "default", data: { nodeType: "ifCondition", config: { left: "{{input.status}}", operator: "equals", right: "200" } }, position: { x: 560, y: 100 } },
      ],
      edges: [
        { id: "e1", source: "s1", target: "s2" },
        { id: "e2", source: "s2", target: "s3" },
      ],
    },
  },
  {
    name: "Blank workflow",
    description: "Start from scratch.",
    definition: { nodes: [], edges: [] },
  },
];

export default function TemplateGallery({ onSelect, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--surface)", borderRadius: 12, padding: 24, width: 480, maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h3>Start from a template</h3>
          <button onClick={onClose}>×</button>
        </div>
        {TEMPLATES.map((t) => (
          <div
            key={t.name}
            onClick={() => onSelect(t.definition)}
            style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8, cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
