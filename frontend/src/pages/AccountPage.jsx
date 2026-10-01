import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, CreditCard, LifeBuoy, LogOut, Plus, ShieldCheck, UserPlus, UserRound, Users } from "lucide-react";
import { api, clearToken, setWorkspace } from "../api.js";
import PricingCards from "../components/PricingCards.jsx";
import ExecutionHistoryPanel from "../components/ExecutionHistoryPanel.jsx";
import { getSupportComposeUrl } from "../support.js";

const MAX_AVATAR_BYTES = 300_000;

function formatAmount(amount, currency) {
  if (amount === null || amount === undefined) return "-";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(amount) / 100); }
  catch { return `${amount} ${currency || ""}`; }
}

export default function AccountPage() {
  const [me, setMe] = useState(null);
  const [billing, setBilling] = useState(null);
  const [history, setHistory] = useState([]);
  const [activity, setActivity] = useState([]);
  const [operations, setOperations] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState("");
  const [members, setMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [error, setError] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const googleLinkRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.me(), api.getBillingStatus(), api.getBillingHistory(), api.getOperations()])
      .then(([account, status, events, systemStatus]) => { setMe(account); setBilling(status); setHistory(events); setOperations(systemStatus); if (status.plan === "pro") api.getAccountActivity().then(setActivity).catch(() => {}); })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID;
    if (!clientId || !googleLinkRef.current) return undefined;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.google?.accounts?.id || !googleLinkRef.current) return;
      googleLinkRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async ({ credential }) => {
          try { await api.linkGoogle(credential); setLinkMessage("Google account linked."); }
          catch (err) { setError(err.message); }
        },
      });
      window.google.accounts.id.renderButton(googleLinkRef.current, { theme: "outline", size: "medium", text: "continue_with" });
    };
    if (window.google?.accounts?.id) render();
    else {
      const timer = window.setInterval(() => { if (window.google?.accounts?.id) { window.clearInterval(timer); render(); } }, 100);
      return () => { cancelled = true; window.clearInterval(timer); };
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (token) api.acceptWorkspaceInvite(token).then(({ workspaceId }) => { setWorkspace(workspaceId); window.history.replaceState({}, "", "/account"); window.location.reload(); }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    api.listWorkspaces().then(({ currentId, workspaces: rows }) => {
      const selected = localStorage.getItem("flowforge_workspace") || currentId;
      if (!localStorage.getItem("flowforge_workspace")) setWorkspace(selected);
      setCurrentWorkspaceId(selected);
      setWorkspaces(rows);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (currentWorkspaceId) api.listWorkspaceMembers(currentWorkspaceId).then(setMembers).catch(() => {});
  }, [currentWorkspaceId]);

  function upgrade(plan) {
    api.startCheckout(plan).then(({ url }) => { window.location.href = url; }).catch((err) => setError(err.message));
  }

  function manageBilling() {
    api.openBillingPortal().then(({ url }) => { window.location.href = url; }).catch((err) => setError(err.message));
  }

  async function createWorkspace(event) {
    event.preventDefault();
    if (!workspaceName.trim()) return;
    try {
      const created = await api.createWorkspace(workspaceName.trim());
      setWorkspace(created.id);
      window.location.reload();
    } catch (err) { setError(err.message); }
  }

  async function inviteMember(event) {
    event.preventDefault();
    const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
    if (!inviteEmail.trim() || !current || !["owner", "admin"].includes(current.role)) return;
    try {
      const created = await api.createWorkspaceInvite(currentWorkspaceId, inviteEmail.trim(), inviteRole);
      setInviteEmail("");
      setInviteLink(created.inviteUrl);
    } catch (err) { setError(err.message); }
  }

  function uploadPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (String(reader.result).length > MAX_AVATAR_BYTES) return setError("Image is too large. Choose one under 300KB.");
      try { await api.updateProfile(reader.result); setMe((current) => ({ ...current, avatarUrl: reader.result })); }
      catch (err) { setError(err.message); }
    };
    reader.readAsDataURL(file);
  }

  const initial = (me?.email || "?")[0].toUpperCase();
  const isPaidPlan = billing?.plan === "starter" || billing?.plan === "pro";
  const supportUrl = getSupportComposeUrl(me?.email);
  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 24 }}>
      <Link to="/workflows" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 22 }}><ArrowLeft size={14} /> Dashboard</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <div><h2 style={{ margin: 0 }}>Account</h2><p style={{ color: "var(--text-muted)", margin: "4px 0 0" }}>Profile, subscription and payment history</p></div>
        <button onClick={() => { clearToken(); navigate("/"); }} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--danger)" }}><LogOut size={14} /> Log out</button>
      </div>
      {error && <div style={{ color: "var(--danger)", marginBottom: 12 }}>{error}</div>}
      <section style={{ padding: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", overflow: "hidden", background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#fff" }}>
            {me?.avatarUrl ? <img src={me.avatarUrl} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initial}
          </div>
          <div><div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}><UserRound size={15} /> {me?.email || "Loading..."}</div><div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>{me?.emailVerified ? "Email verified" : "Email verification pending"}</div></div>
          <label style={{ marginLeft: "auto", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><Camera size={14} /> Change photo<input type="file" accept="image/*" onChange={uploadPhoto} style={{ display: "none" }} /></label>
        </div>
        {import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID && <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}><div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Link Google Sign-In to this existing account. The Google email must match.</div><div ref={googleLinkRef} /><div style={{ color: "var(--success)", fontSize: 12, marginTop: 6 }}>{linkMessage}</div></div>}
      </section>
      {workspaces.length > 0 && <section className="workspace-section" aria-labelledby="workspace-heading">
        <div className="account-section-title"><div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Users size={18} color="var(--primary)" /><h3 id="workspace-heading">Workspace</h3></div><p>Keep automations and teammates organized in one shared space.</p></div><span className="workspace-role">{workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.role || "member"}</span></div>
        <div className="workspace-controls">
          <select value={currentWorkspaceId} onChange={(event) => { setWorkspace(event.target.value); window.location.reload(); }} aria-label="Current workspace">
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          {billing?.plan !== "free" && <form onSubmit={createWorkspace} className="workspace-create"><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="New workspace name" aria-label="New workspace name" /><button type="submit" title="Create workspace" aria-label="Create workspace"><Plus size={14} /></button></form>}
        </div>
        <div className="member-list">{members.map((member) => {
          const currentRole = workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.role;
          const canManage = billing?.plan === "pro" && ["owner", "admin"].includes(currentRole) && member.role !== "owner" && member.id !== me?.id;
          return <div key={member.id}><span>{member.email}</span><small>{member.role}</small>{canManage && <span style={{ display: "flex", gap: 6 }}><select value={member.role} onChange={async (event) => { try { await api.updateWorkspaceMember(currentWorkspaceId, member.id, event.target.value); setMembers((rows) => rows.map((row) => row.id === member.id ? { ...row, role: event.target.value } : row)); } catch (err) { setError(err.message); } }} aria-label={`Role for ${member.email}`}><option value="member">Member</option><option value="admin">Admin</option></select><button type="button" onClick={async () => { try { await api.removeWorkspaceMember(currentWorkspaceId, member.id); setMembers((rows) => rows.filter((row) => row.id !== member.id)); } catch (err) { setError(err.message); } }} title={`Remove ${member.email}`}>Remove</button></span>}</div>;
        })}</div>
        {workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.role !== "member" && billing?.plan !== "free" && <form onSubmit={inviteMember} className="invite-form"><UserPlus size={15} /><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" aria-label="Teammate email" required />{billing?.plan === "pro" && <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)} aria-label="Invitation role"><option value="member">Member</option><option value="admin">Admin</option></select>}<button type="submit">Invite</button></form>}
        {inviteLink && <div className="invite-result"><span>Invite link ready to share</span><input readOnly value={inviteLink} onFocus={(event) => event.target.select()} aria-label="Workspace invite link" /></div>}
      </section>}
      {billing && <><div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24 }}><ShieldCheck size={18} color="var(--success)" /><h3 style={{ margin: 0 }}>Subscription</h3></div><PricingCards currentPlan={billing.plan} onUpgrade={upgrade} onManage={manageBilling} /></>}
      {isPaidPlan && <section className="support-section" aria-labelledby="support-heading">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><LifeBuoy size={18} color="var(--primary)" /><h3 id="support-heading" style={{ margin: 0 }}>Priority support</h3></div>
          <p>Have a question about your workflows or plan? Send us a message and we will help.</p>
        </div>
        <a className={`support-action${supportUrl ? "" : " is-disabled"}`} href={supportUrl || undefined} target={supportUrl ? "_blank" : undefined} rel={supportUrl ? "noreferrer" : undefined} onClick={(event) => { if (!supportUrl) event.preventDefault(); }}>
          <LifeBuoy size={15} /> {supportUrl ? "Contact support" : "Support email not configured"}
        </a>
      </section>}
      <section style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><CreditCard size={18} /><h3 style={{ margin: 0 }}>Payment history</h3></div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          {history.length === 0 ? <p style={{ padding: 18, color: "var(--text-muted)", margin: 0 }}>No transactions yet.</p> : history.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 16, padding: "13px 16px", borderBottom: "1px solid var(--border)", fontSize: 13 }}><span>{item.description || item.type}</span><span style={{ color: item.status === "succeeded" || item.status === "paid" ? "var(--success)" : "var(--text-muted)" }}>{item.status}</span><span>{formatAmount(item.amount, item.currency)}</span></div>)}
        </div>
      </section>
      {operations && <section className="account-ops" aria-labelledby="operations-heading">
        <div className="account-section-title"><div><h3 id="operations-heading">System status</h3><p>Your workspace activity over the last 24 hours.</p></div><span className="status-pill"><span />Operational</span></div>
        <div className="ops-grid">
          <div><strong>{operations.executionsLast24Hours}</strong><span>Executions</span></div>
          <div><strong>{operations.jobs.pending || 0}</strong><span>Queued jobs</span></div>
          <div><strong>{operations.jobs.failed || 0}</strong><span>Failed jobs</span></div>
          <div><strong>{operations.workflowCount}</strong><span>Workflows</span></div>
        </div>
      </section>}
      <section style={{ marginTop: 24 }} aria-labelledby="execution-history-heading">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><h3 id="execution-history-heading" style={{ margin: 0 }}>Execution history</h3></div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <ExecutionHistoryPanel fullScreen />
        </div>
      </section>
      {activity.length > 0 && <section className="account-activity" aria-labelledby="activity-heading">
        <div className="account-section-title"><div><h3 id="activity-heading">Recent activity</h3><p>Security and workspace changes on your account.</p></div></div>
        <div className="activity-list">{activity.slice(0, 8).map((item) => <div key={item.id}><span className="activity-dot" /><div><strong>{item.action.replaceAll(".", " ")}</strong><time>{new Date(item.created_at).toLocaleString()}</time></div></div>)}</div>
      </section>}
    </div>
  );
}