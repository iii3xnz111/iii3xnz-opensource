import { v4 as uuid } from "uuid";
import db from "./db/index.js";
import { getPlan, hasPlanFeature } from "./plan.js";

export function normalizePermissionRole(role) {
  if (role === "editor") return "editor";
  if (role === "viewer") return "viewer";
  return "viewer";
}

export async function ensureWorkspace(userId) {
  const user = await db.prepare("SELECT default_workspace_id, email FROM users WHERE id = ?").get(userId);
  if (!user) throw new Error("Account not found");
  if (user.default_workspace_id) {
    const member = await db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(user.default_workspace_id, userId);
    if (member) return user.default_workspace_id;
  }

  const workspaceId = uuid();
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)").run(workspaceId, `${user.email.split("@")[0]}'s workspace`, userId);
  await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(workspaceId, userId);
  await db.prepare("UPDATE users SET default_workspace_id = ? WHERE id = ?").run(workspaceId, userId);
  await db.prepare("UPDATE workflows SET workspace_id = ? WHERE user_id = ? AND workspace_id IS NULL").run(workspaceId, userId);
  return workspaceId;
}

export async function getWorkspaceId(userId, requestedId = null) {
  const defaultId = await ensureWorkspace(userId);
  const workspaceId = requestedId || defaultId;
  const member = await db.prepare("SELECT workspace_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId);
  if (!member) {
    const error = new Error("You do not belong to that workspace");
    error.status = 404;
    throw error;
  }
  return workspaceId;
}

export async function getWorkspaceRole(workspaceId, userId) {
  const row = await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId);
  return row?.role || null;
}

export async function getWorkspaceContext(userId, requestedId = null) {
  const workspaceId = await getWorkspaceId(userId, requestedId);
  const context = await db.prepare(
    `SELECT w.id, w.owner_id, u.plan, wm.role
     FROM workspaces w
     JOIN users u ON u.id = w.owner_id
     JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?
     WHERE w.id = ?`
  ).get(userId, workspaceId);
  if (!context) throw new Error("You do not belong to that workspace");
  return { ...context, plan: getPlan(context.plan) };
}

export function canManageWorkspace(role, plan) {
  return hasPlanFeature(plan, "advancedRoles") ? role === "owner" || role === "admin" : role === "owner";
}

export function canManageMembers(role, plan = "free") {
  return role === "owner" || (role === "admin" && hasPlanFeature(plan, "advancedRoles"));
}

export async function getWorkflowPermission(workflowId, userId, workspaceId = null) {
  const row = workspaceId
    ? await db.prepare("SELECT role FROM workflow_permissions WHERE workflow_id = ? AND user_id = ? AND workspace_id = ?").get(workflowId, userId, workspaceId)
    : await db.prepare("SELECT role FROM workflow_permissions WHERE workflow_id = ? AND user_id = ?").get(workflowId, userId);
  return row ? normalizePermissionRole(row.role) : null;
}

export async function getEffectiveWorkflowRole(workspaceId, workflowId, userId) {
  const workflow = await db.prepare("SELECT user_id FROM workflows WHERE id = ? AND workspace_id = ?").get(workflowId, workspaceId);
  if (!workflow) return null;
  const membership = await db.prepare(
    `SELECT wm.role, u.plan FROM workspace_members wm
     JOIN workspaces w ON w.id = wm.workspace_id
     JOIN users u ON u.id = w.owner_id
     WHERE wm.workspace_id = ? AND wm.user_id = ?`
  ).get(workspaceId, userId);
  if (!membership) return null;
  if (workflow.user_id === userId || membership.role === "owner" || membership.role === "admin") return "editor";

  const permissionRole = await getWorkflowPermission(workflowId, userId, workspaceId);
  if (permissionRole) return permissionRole;

  if (!hasPlanFeature(membership.plan, "workflowPermissions")) return "editor";

  return null;
}

export async function canAccessWorkflow(workspaceId, workflowId, userId, action = "read") {
  const role = await getEffectiveWorkflowRole(workspaceId, workflowId, userId);
  if (!role) return false;
  if (action === "read") return true;
  return role === "editor";
}

export function requireWorkspace(options = {}) {
  return async (req, res, next) => {
    try {
      const context = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
      if (options.feature && !hasPlanFeature(context.plan, options.feature)) {
        return res.status(403).json({ error: `${options.feature} is not available on the ${context.plan} plan` });
      }
      if (options.roles && !options.roles.includes(context.role)) return res.status(403).json({ error: "Insufficient workspace permissions" });
      req.workspace = context;
      next();
    } catch (error) {
      if (error.message === "You do not belong to that workspace") return res.status(404).json({ error: "Workspace not found" });
      next(error);
    }
  };
}