import React, { useState } from "react";
import { Webhook, Globe, ArrowRight } from "lucide-react";

const STEPS = [
  {
    title: "Welcome to iii3xnz",
    body: "Automate anything with a simple idea: something happens (a Trigger), then iii3xnz does something about it (Actions).",
    visual: (
      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", padding: "20px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#6366f115", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Webhook size={22} color="#6366f1" />
          </div>
          <span style={{ fontSize: 11 }}>Trigger</span>
        </div>
        <ArrowRight size={18} color="var(--text-muted)" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "#0ea5e915", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Globe size={22} color="#0ea5e9" />
          </div>
          <span style={{ fontSize: 11 }}>Action</span>
        </div>
      </div>
    ),
  },
  {
    title: "Build by dragging",
    body: "Drag nodes from the left panel onto the canvas, then connect them by dragging from one node's edge to the next. Click any node to configure it.",
  },
  {
    title: "Save, then Run",
    body: "Save stores your workflow. Run now tests it immediately so you can see exactly what each step produced, before you turn it on for real traffic.",
  },
];

export default function OnboardingModal({ onStartTemplate, onStartBlank, onDismiss }) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "var(--surface)", borderRadius: 14, padding: 28, width: 380, textAlign: "center" }}>
        <h3 style={{ marginBottom: 8 }}>{current.title}</h3>
        {current.visual}
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>{current.body}</p>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, margin: "16px 0" }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ width: 6, height: 6, borderRadius: 3, background: i === step ? "var(--primary)" : "var(--border)" }} />
          ))}
        </div>

        {isLast ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={onStartTemplate} style={{ padding: "8px 0", fontWeight: 600 }}>
              Start from a template
            </button>
            <button onClick={onStartBlank} style={{ padding: "8px 0", background: "none", border: "1px solid var(--border)" }}>
              Start from scratch
            </button>
          </div>
        ) : (
          <button onClick={() => setStep(step + 1)} style={{ padding: "8px 24px" }}>
            Next
          </button>
        )}

        <div style={{ marginTop: 12 }}>
          <button onClick={onDismiss} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
