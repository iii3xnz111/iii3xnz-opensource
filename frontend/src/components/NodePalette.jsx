import React, { useState } from "react";
import { Search } from "lucide-react";
import { NODE_REGISTRY, CATEGORIES, PLAN_NODE_TYPES } from "../nodeRegistry.js";

export default function NodePalette({ onSelect, plan = "free" }) {
  const [query, setQuery] = useState("");
  const allowedTypes = PLAN_NODE_TYPES[plan] || PLAN_NODE_TYPES.free;

  const filtered = Object.entries(NODE_REGISTRY).filter(([type, meta]) =>
    allowedTypes.has(type) && (meta.label + type).toLowerCase().includes(query.toLowerCase())
  );

  function onDragStart(e, nodeType) {
    e.dataTransfer.setData("application/flowforge-node", nodeType);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={13} style={{ position: "absolute", left: 8, top: 8, color: "var(--text-muted)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes..."
          style={{ width: "100%", padding: "6px 6px 6px 26px", fontSize: 12, boxSizing: "border-box" }}
        />
      </div>

      {CATEGORIES.map((cat) => {
        const items = filtered.filter(([, meta]) => meta.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>
              {cat}
            </div>
            {items.map(([type, meta]) => {
              const Icon = meta.icon;
              return (
                <div
                  key={type}
                  draggable={!onSelect}
                  onDragStart={onSelect ? undefined : (e) => onDragStart(e, type)}
                  onClick={onSelect ? () => onSelect(type) : undefined}
                  title={meta.description}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 8px",
                    marginBottom: 4,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    cursor: onSelect ? "pointer" : "grab",
                    fontSize: 12,
                    background: "var(--surface-2)",
                  }}
                >
                  <Icon size={14} color={meta.color} />
                  {meta.label}
                </div>
              );
            })}
          </div>
        );
      })}
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 8 }}>
        {onSelect ? "Tap a node to add it →" : "Drag a node onto the canvas →"}
        <br />{allowedTypes.size} nodes available on {plan} plan
      </div>
    </div>
  );
}
