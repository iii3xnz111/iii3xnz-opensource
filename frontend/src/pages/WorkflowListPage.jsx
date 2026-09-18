import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Workflow, KeyRound, Plus, Pencil, Trash2 } from "lucide-react";
import { api } from "../api.js";
import OnboardingModal from "../components/OnboardingModal.jsx";
import UsagePanel from "../components/UsagePanel.jsx";
import EmailVerificationBanner from "../components/EmailVerificationBanner.jsx";
import PricingCards from "../components/PricingCards.jsx";
import AccountMenu from "../components/AccountMenu.jsx";

const ONBOARDING_KEY = "ff_onboarding_dismissed";

export default function WorkflowListPage() {
  const [workflows, setWorkflows] = useState([]);
  const [billing, setBilling] = useState(null);
  const [usage, setUsage] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");
  const [loadedWorkflows, setLoadedWorkflows] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [newName, setNewName] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.listWorkflows().then((rows) => {
      setWorkflows(rows);
      setUsage((current) => current ? { ...current, workflowCount: rows.length } : current);
      setLoadedWorkflows(true);
    }).catch((e) => setError(e.message));
    api.getBillingStatus().then(setBilling).catch(() => {});
    api.getUsage().then(setUsage).catch(() => {});
    api.me().then(setMe).catch(() => {});
  }, []);

  const showOnboarding = loadedWorkflows && workflows.length === 0 && !localStorage.getItem(ONBOARDING_KEY);

  function dismissOnboarding() {
    localStorage.setItem(ONBOARDING_KEY, "1");
    setWorkflows((w) => [...w]); // trigger re-render without refetching
  }

  async function startFromOnboarding(skipTemplate) {
    localStorage.setItem(ONBOARDING_KEY, "1");
    try {
      const { id } = await api.createWorkflow("Untitled workflow", { nodes: [], edges: [] });
      if (skipTemplate) sessionStorage.setItem("ff_skip_template_prompt", id);
      navigate(`/workflows/${id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function manageBilling() {
    try {
      const { url } = await api.openBillingPortal();
      window.location.href = url;
    } catch (e) {
      setError(e.message);
    }
  }

  async function upgrade(plan) {
    try {
      const { url } = await api.startCheckout(plan);
      window.location.href = url;
    } catch (e) {
      setError(e.message);
    }
  }

  async function createNew() {
    try {
      const { id } = await api.createWorkflow("Untitled workflow", { nodes: [], edges: [] });
      navigate(`/workflows/${id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRenameStart(e, wf) {
    e.preventDefault();
    e.stopPropagation();
    setRenamingId(wf.id);
    setNewName(wf.name);
  }

  async function handleRenameSave(e, wfId) {
    e.preventDefault();
    e.stopPropagation();
    if (!newName.trim()) {
      setError("Workflow name cannot be empty");
      return;
    }
    try {
      await api.updateWorkflow(wfId, { name: newName });
      setWorkflows((wfs) =>
        wfs.map((wf) => (wf.id === wfId ? { ...wf, name: newName } : wf))
      );
      setRenamingId(null);
      setNewName("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRenameCancel(e) {
    e.preventDefault();
    e.stopPropagation();
    setRenamingId(null);
    setNewName("");
  }

  async function handleDelete(e, wfId) {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this workflow?")) {
      try {
        await api.deleteWorkflow(wfId);
        setWorkflows((wfs) => wfs.filter((wf) => wf.id !== wfId));
        setUsage((current) => current ? { ...current, workflowCount: current.workflowCount - 1 } : current);
      } catch (e) {
        setError(e.message);
      }
    }
  }

  return (
    <div className="app-shell">
      <div className="app-topbar">
        <Link to="/" className="app-brand">iii3xnz</Link>
        <div className="app-actions">
          <Link to="/credentials"><button aria-label="Credentials" title="Credentials" style={{ display: "flex", alignItems: "center", gap: 6 }}><KeyRound size={14} /> <span>Credentials</span></button></Link>
          <AccountMenu
            me={me}
            billing={billing}
            onAvatarChange={(url) => setMe((m) => ({ ...m, avatarUrl: url }))}
            onManageBilling={manageBilling}
          />
        </div>
      </div>

      <div className="page-heading">
        <div><h1>Your workflows</h1><p>Build, monitor, and run your automations from one place.</p></div>
        <button onClick={createNew} className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={14} /> New workflow
        </button>
      </div>

      {me && !me.emailVerified && (
        <EmailVerificationBanner onVerified={() => setMe((m) => ({ ...m, emailVerified: true }))} />
      )}

      <UsagePanel usage={usage} />

      {error && <div style={{ color: "var(--danger)" }}>{error}</div>}

      {workflows.length === 0 ? (
        <div className="empty-state">
          <Workflow size={28} color="var(--text-muted)" style={{ marginBottom: 8 }} />
          <p>No workflows yet. Create your first automation to get started.</p>
          <button onClick={createNew} className="btn-primary" style={{ display: "flex", alignItems: "center", gap: 6 }}><Plus size={14} /> Create workflow</button>
        </div>
      ) : (
        <div className="workflow-list">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="surface workflow-row"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <Link
                to={`/workflows/${wf.id}`}
                style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, textDecoration: "none", color: "inherit" }}
              >
                <Workflow size={16} color="var(--text-muted)" />
                {renamingId === wf.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSave(e, wf.id);
                      if (e.key === "Escape") handleRenameCancel(e);
                    }}
                    style={{
                      fontWeight: 500,
                      padding: "4px 8px",
                      border: "1px solid var(--primary)",
                      borderRadius: "4px",
                      backgroundColor: "var(--surface)",
                      color: "var(--text)",
                      fontSize: "inherit",
                    }}
                  />
                ) : (
                  <span style={{ fontWeight: 500 }}>{wf.name}</span>
                )}
              </Link>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {renamingId === wf.id ? (
                  <>
                    <button
                      onClick={(e) => handleRenameSave(e, wf.id)}
                      style={{
                        background: "var(--success)",
                        color: "white",
                        border: "none",
                        padding: "4px 12px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 500,
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={handleRenameCancel}
                      style={{
                        background: "var(--text-muted)",
                        color: "white",
                        border: "none",
                        padding: "4px 12px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "12px",
                        fontWeight: 500,
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={(e) => handleRenameStart(e, wf)}
                      title="Rename workflow"
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        color: "var(--text-muted)",
                        transition: "color 0.2s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, wf.id)}
                      title="Delete workflow"
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "4px 8px",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        color: "var(--text-muted)",
                        transition: "color 0.2s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: wf.active ? "var(--success)" : "var(--text-muted)", marginLeft: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: wf.active ? "var(--success)" : "var(--text-muted)" }} />
                  {wf.active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {billing && (
        <section className="billing-section" aria-labelledby="subscription-heading">
          <div className="section-heading">
            <div>
              <h2 id="subscription-heading">Subscription</h2>
              <p>Manage your plan and choose the right capacity for your automations.</p>
            </div>
            <span className="current-plan">Current plan: <strong>{billing.plan}</strong></span>
          </div>
          <PricingCards currentPlan={billing.plan} onUpgrade={upgrade} onManage={manageBilling} />
        </section>
      )}

      {showOnboarding && (
        <OnboardingModal
          onStartTemplate={() => startFromOnboarding(false)}
          onStartBlank={() => startFromOnboarding(true)}
          onDismiss={dismissOnboarding}
        />
      )}
    </div>
  );
}
