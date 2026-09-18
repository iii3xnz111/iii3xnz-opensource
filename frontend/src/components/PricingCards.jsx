import React from "react";
import { Check } from "lucide-react";
import { PLAN_CATALOG, PLAN_ORDER } from "../planContract.js";

export default function PricingCards({ currentPlan, onUpgrade, onManage }) {
  if (import.meta.env.VITE_SELF_HOSTED === "true") {
    return <div style={{ margin: "16px 0", padding: 20, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)" }}>
      <strong>Self-hosted edition</strong>
      <p style={{ marginBottom: 0, color: "var(--text-muted)", fontSize: 13 }}>All workflow features and integrations are enabled. You operate the infrastructure and billing is disabled.</p>
    </div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, margin: "16px 0" }}>
      {PLAN_ORDER.map((key) => {
        const plan = PLAN_CATALOG[key];
        const isCurrent = currentPlan === key;
        const isPopular = key === "starter";
        return (
          <div
            key={key}
            style={{
              position: "relative",
              border: `1px solid ${isCurrent || isPopular ? "var(--primary)" : "var(--border)"}`,
              borderRadius: 12,
              padding: 20,
              background: "var(--surface)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {isPopular && !isCurrent && (
              <div style={{ position: "absolute", top: -10, left: 16, background: "var(--primary)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Best value
              </div>
            )}
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {plan.label}
            </div>
            <div style={{ minHeight: 32, marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
              {plan.description}
            </div>
            <div style={{ margin: "8px 0 16px" }}>
              <span style={{ fontSize: 28, fontWeight: 700 }}>{plan.price}</span>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{plan.period}</span>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1 }}>
              {[...plan.limits, ...plan.features].map((b) => (
                <li key={b} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>
                  <Check size={14} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />
                  {b}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 16 }}>
              {isCurrent ? (
                key === "free" ? (
                  <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>Current plan</div>
                ) : (
                  <button onClick={onManage} style={{ width: "100%" }}>Manage billing</button>
                )
              ) : key === "free" ? (
                <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>&nbsp;</div>
              ) : (
                <button onClick={() => onUpgrade(key)} className="btn-primary" style={{ width: "100%" }}>
                  Upgrade to {plan.label}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
