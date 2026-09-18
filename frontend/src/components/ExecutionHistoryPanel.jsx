import React, { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, ChevronLeft } from "lucide-react";
import { api } from "../api.js";
import ExecutionTrace from "./ExecutionTrace.jsx";

function durationLabel(execution) {
  if (!execution.finished_at || !execution.started_at) return "running";
  return `${Math.max(0, new Date(execution.finished_at) - new Date(execution.started_at))}ms`;
}

export default function ExecutionHistoryPanel({ workflowId, onClose, fullScreen }) {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); // execution detail with log
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api.getExecutions(workflowId).then((rows) => { setExecutions(rows); setLoading(false); }).catch((err) => { setError(err.message); setLoading(false); });
  }, [workflowId]);

  async function openDetail(execId) {
    setDetailLoading(true);
    try {
      const detail = await api.getExecutionDetail(workflowId, execId);
      setSelected(detail);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div style={fullScreen
      ? { width: "100%", padding: 16, boxSizing: "border-box" }
      : { position: "absolute", top: 0, right: 0, width: 360, height: "100%", background: "var(--surface)", borderLeft: "1px solid var(--border)", padding: 16, overflowY: "auto", boxShadow: "-2px 0 8px rgba(0,0,0,0.4)" }
    }>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        {selected ? (
          <button onClick={() => setSelected(null)} style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "none", cursor: "pointer", fontSize: 13 }}>
            <ChevronLeft size={14} /> Back
          </button>
        ) : (
          <h4 style={{ margin: 0 }}>Run history</h4>
        )}
        {onClose && <button onClick={onClose}>×</button>}
      </div>

      {selected ? (
        detailLoading ? (
          <Loader2 size={16} />
        ) : (
          <>
            {!workflowId && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{selected.workflow_name}</div>}
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              {new Date(selected.started_at).toLocaleString()} — <strong>{selected.status}</strong> — {durationLabel(selected)}
            </div>
            <ExecutionTrace log={selected.log} />
          </>
        )
      ) : (
        <>
          {loading && <Loader2 size={16} />}
          {!loading && error && <p style={{ fontSize: 12, color: "var(--danger)" }}>{error}</p>}
          {!loading && !error && executions.length === 0 && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No runs yet.</p>}
          {executions.map((ex) => (
            <div
              key={ex.id}
              onClick={() => openDetail(ex.id)}
              style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 4px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface)")}
            >
              {ex.status === "success" ? (
                <CheckCircle2 size={16} color="#22c55e" style={{ flexShrink: 0, marginTop: 2 }} />
              ) : (
                <XCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
              )}
              <div style={{ fontSize: 12 }}>
                {!workflowId && <div style={{ fontWeight: 600 }}>{ex.workflow_name}</div>}
                <div>{new Date(ex.started_at).toLocaleString()}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{ex.status} — {durationLabel(ex)} — click for details</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
