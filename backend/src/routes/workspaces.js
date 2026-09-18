import { Router } from "express";
import crypto from "crypto";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { requireAuth } from "../auth.js";
import { canManageMembers, canManageWorkspace, ensureWorkspace, getWorkspaceContext, getWorkspaceId, getWorkspaceRole } from "../workspace.js";
import { hasPlanFeature } from "../plan.js";
import { recordAudit } from "../audit.js";
import { sendTransactionalEmail } from "../mailer.js";

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get("/", requireAuth, async (req, res) => {
  const currentId = await ensureWorkspace(req.user.id);
  const rows = await db.prepare(
    "SELECT w.id, w.name, w.owner_id, wm.role FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id WHERE wm.user_id = ? ORDER BY w.created_at ASC"
  ).all(req.user.id);
  res.json({ currentId, workspaces: rows });
});

router.post("/", requireAuth, async (req, res) => {
  const user = await db.prepare("SELECT plan FROM users WHERE id = ?").get(req.user.id);
  if (!hasPlanFeature(user?.plan, "sharedWorkspaces")) return res.status(403).json({ error: "Shared workspaces are available on Starter and Pro plans" });
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 80) return res.status(400).json({ error: "Workspace name must be 1-80 characters" });
  const id = uuid();
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)").run(id, name, req.user.id);
  await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(id, req.user.id);
  await recordAudit(req.user.id, "workspace.created", "workspace", id, { name });
  res.json({ id, name, role: "owner" });
});

router.get("/:id/members", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.params.id);
  const rows = await db.prepare(
    "SELECT u.id, u.email, wm.role, wm.created_at FROM workspace_members wm JOIN users u ON u.id = wm.user_id WHERE wm.workspace_id = ? ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, wm.created_at"
  ).all(workspaceId);
  res.json(rows);
});

router.patch("/:id/members/:userId", requireAuth, async (req, res) => {
  const context = await getWorkspaceContext(req.user.id, req.params.id);
  if (!hasPlanFeature(context.plan, "advancedRoles")) return res.status(403).json({ error: "Role management is available on Pro" });
  if (!canManageWorkspace(context.role, context.plan)) return res.status(403).json({ error: "Only workspace owners and admins can manage roles" });
  if (req.params.userId === context.owner_id) return res.status(409).json({ error: "The workspace owner role cannot be changed" });
  const role = req.body.role;
  if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: "Role must be admin or member" });
  const target = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(context.id, req.params.userId);
  if (!target) return res.status(404).json({ error: "Member not found" });
  if (context.role === "admin" && (target.role === "admin" || role === "admin")) return res.status(403).json({ error: "Admins cannot manage admins" });
  await db.prepare("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?").run(role, context.id, req.params.userId);
  await recordAudit(req.user.id, "workspace.member_role_changed", "workspace", context.id, { userId: req.params.userId, role });
  res.json({ ok: true, role });
});

router.delete("/:id/members/:userId", requireAuth, async (req, res) => {
  const context = await getWorkspaceContext(req.user.id, req.params.id);
  if (!canManageMembers(context.role, context.plan)) return res.status(403).json({ error: "Only workspace owners and admins can remove members" });
  if (req.params.userId === context.owner_id) return res.status(409).json({ error: "The workspace owner cannot be removed" });
  const target = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(context.id, req.params.userId);
  if (!target) return res.status(404).json({ error: "Member not found" });
  if (context.role === "admin" && target.role === "admin") return res.status(403).json({ error: "Admins cannot remove admins" });
  await db.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?").run(context.id, req.params.userId);
  await recordAudit(req.user.id, "workspace.member_removed", "workspace", context.id, { userId: req.params.userId });
  res.json({ ok: true });
});

router.get("/:id/projects", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.params.id);
  res.json(await db.prepare("SELECT id, name, created_by, created_at, updated_at FROM projects WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId));
});

router.post("/:id/projects", requireAuth, async (req, res) => {
  const context = await getWorkspaceContext(req.user.id, req.params.id);
  if (!hasPlanFeature(context.plan, "sharedWorkspaces")) return res.status(403).json({ error: "Shared projects are available on Starter and Pro plans" });
  if (!canManageMembers(context.role, context.plan)) return res.status(403).json({ error: "Only workspace owners and admins can create projects" });
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 80) return res.status(400).json({ error: "Project name must be 1-80 characters" });
  const id = uuid();
  try {
    await db.prepare("INSERT INTO projects (id, workspace_id, name, created_by) VALUES (?, ?, ?, ?)").run(id, context.id, name, req.user.id);
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "A project with that name already exists" });
    throw error;
  }
  await recordAudit(req.user.id, "project.created", "project", id, { workspaceId: context.id, name });
  res.json({ id, name, workspaceId: context.id });
});

router.delete("/:id/projects/:projectId", requireAuth, async (req, res) => {
  const context = await getWorkspaceContext(req.user.id, req.params.id);
  if (!canManageMembers(context.role, context.plan)) return res.status(403).json({ error: "Only workspace owners and admins can delete projects" });
  const result = await db.prepare("DELETE FROM projects WHERE id = ? AND workspace_id = ?").run(req.params.projectId, context.id);
  if (!result.changes) return res.status(404).json({ error: "Project not found" });
  await recordAudit(req.user.id, "project.deleted", "project", req.params.projectId, { workspaceId: context.id });
  res.json({ ok: true });
});

router.post("/:id/invites", requireAuth, async (req, res) => {
  const context = await getWorkspaceContext(req.user.id, req.params.id);
  const workspaceId = context.id;
  if (!hasPlanFeature(context.plan, "invitations")) return res.status(403).json({ error: "Member invitations are available on Starter and Pro plans" });
  const role = req.body.role === "admin" && hasPlanFeature(context.plan, "advancedRoles") ? "admin" : "member";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!canManageMembers(context.role, context.plan)) return res.status(403).json({ error: "Only workspace owners and admins can invite members" });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Please provide a valid email address" });
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const id = uuid();
  await db.prepare("INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, NOW() + INTERVAL '7 days')").run(id, workspaceId, email, role, hash);
  await recordAudit(req.user.id, "workspace.invite_created", "workspace", workspaceId, { email, role });
  const workspace = await db.prepare("SELECT name FROM workspaces WHERE id = ?").get(workspaceId);
  const inviteUrl = `${process.env.APP_URL || "http://localhost:5173"}/auth?invite=${raw}`;
  let emailSent = true;
  try {
    await sendTransactionalEmail({
      to: email,
      subject: `You're invited to join ${workspace.name} on iii3xnz`,
      text: `You have been invited to join the ${workspace.name} workspace on iii3xnz.\n\nOpen this link to accept the invitation: ${inviteUrl}\n\nThis invitation expires in 7 days.`,
    });
  } catch (err) {
    emailSent = false;
    console.error("[WORKSPACE INVITE EMAIL FAILED]", err.message);
  }
  res.json({ id, email, role, inviteUrl, emailSent });
});

router.post("/invites/:token/accept", requireAuth, async (req, res) => {
  const hash = crypto.createHash("sha256").update(req.params.token).digest("hex");
  const invite = await db.prepare("SELECT * FROM workspace_invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > NOW()").get(hash);
  if (!invite) return res.status(400).json({ error: "Invite is invalid or expired" });
  const user = await db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id);
  if (user.email !== invite.email) return res.status(403).json({ error: "This invite was sent to a different email address" });
  await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (workspace_id, user_id) DO NOTHING").run(invite.workspace_id, req.user.id, invite.role);
  await db.prepare("UPDATE workspace_invites SET accepted_at = NOW() WHERE id = ?").run(invite.id);
  await recordAudit(req.user.id, "workspace.invite_accepted", "workspace", invite.workspace_id, { inviteId: invite.id });
  res.json({ ok: true, workspaceId: invite.workspace_id });
});

export default router;