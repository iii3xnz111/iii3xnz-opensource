import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { requireAuth } from "../auth.js";
import { executeWorkflow } from "../engine/executeWorkflow.js";
import { syncSchedules } from "../engine/scheduler.js";
import { recordAudit } from "../audit.js";
import { canAccessWorkflow, getEffectiveWorkflowRole, getWorkspaceContext, getWorkspaceId } from "../workspace.js";
import { hasPlanFeature, PLAN_LIMITS, PLAN_NODE_TYPES, validatePlanNodes } from "../plan.js";

export { PLAN_LIMITS, PLAN_NODE_TYPES } from "../plan.js";

const router = Router();

const MAX_NAME_LENGTH = 200;
const MAX_DEFINITION_BYTES = 500_000; // 500KB — generous for a workflow graph, prevents abuse

function validateWorkflowInput(name, definition) {
  if (name !== undefined && (typeof name !== "string" || name.length > MAX_NAME_LENGTH)) {
    return `Name must be a string under ${MAX_NAME_LENGTH} characters`;
  }
  if (definition !== undefined) {
    if (typeof definition !== "object" || definition === null) return "Definition must be an object";
    if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
      return "Definition must have 'nodes' and 'edges' arrays";
    }
    if (JSON.stringify(definition).length > MAX_DEFINITION_BYTES) {
      return "Workflow definition is too large";
    }
  }
  return null;
}

// NOTE: datetime('now', '-1 day') was SQLite syntax — Postgres's equivalent
// is NOW() - INTERVAL '1 day'. Also, Postgres returns COUNT(*) as a string
// (it's a bigint under the hood), so Number(...) here matters — without it,
// "5" >= 100 would still work via JS's loose comparison, but relying on that
// coercion implicitly is fragile, so it's made explicit.
export async function countExecutionsInWindow(userId, plan = "free", workspaceId = null) {
  const period = plan === "free" ? "day" : "month";
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM executions e
      WHERE e.user_id = ? AND (?::text IS NULL OR e.workspace_id = ?) AND e.started_at::timestamptz >= DATE_TRUNC('${period}', NOW())`
    )
    .get(userId, workspaceId, workspaceId);
  return Number(row.c);
}

export const countExecutionsToday = countExecutionsInWindow;

export class ExecutionLimitError extends Error {
  constructor(limit) {
    super(`${limit.executionWindow === "day" ? "Daily" : "Monthly"} execution limit reached (${limit.maxExecutions}). Upgrade for more.`);
    this.name = "ExecutionLimitError";
    this.status = 429;
  }
}

// Serialize the quota check and execution start per user so concurrent manual,
// scheduled, and webhook runs cannot all pass the same pre-execution count.
export async function withExecutionQuota(userId, plan = "free", callback, reservationJobId = null, workspaceId = null) {
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const client = await db.pool.connect();
  let reservationId = null;
  let lockKey;
  let clientReleased = false;
  try {
    lockKey = workspaceId || userId;
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    const period = limit.executionWindow === "day" ? "day" : "month";
    const row = await client.query(
      `SELECT
        (SELECT COUNT(*) FROM executions WHERE user_id = $1 AND ($3::text IS NULL OR workspace_id = $3) AND started_at::timestamptz >= DATE_TRUNC('${period}', NOW()))
        + (SELECT COUNT(*) FROM jobs WHERE user_id = $1 AND ($3::text IS NULL OR workspace_id = $3) AND quota_reserved = 1 AND created_at >= DATE_TRUNC('${period}', NOW()) AND ($2::text IS NULL OR id <> $2))
        + (SELECT COUNT(*) FROM quota_reservations WHERE user_id = $1 AND ($3::text IS NULL OR workspace_id = $3) AND created_at >= DATE_TRUNC('${period}', NOW())) AS c`,
      [userId, reservationJobId, workspaceId]
    );
    if (Number(row.rows[0].c) >= limit.maxExecutions) {
      throw new ExecutionLimitError(limit);
    }
    if (!reservationJobId) {
      reservationId = uuid();
      await client.query(
        "INSERT INTO quota_reservations (id, user_id, workspace_id) VALUES ($1, $2, $3)",
        [reservationId, userId, workspaceId]
      );
    }
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    client.release();
    clientReleased = true;
    return await callback();
  } finally {
    if (client && !clientReleased) {
      if (lockKey) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => {});
      client.release();
    }
    if (reservationId) await db.prepare("DELETE FROM quota_reservations WHERE id = ?").run(reservationId).catch(() => {});
  }
}

export async function withQueuedExecutionQuota(userId, plan = "free", callback, workspaceId = null) {
  return withExecutionQuota(userId, plan, callback, null, workspaceId);
}

async function withWorkflowQuota(workspaceId, limit, callback) {
  const client = await db.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [`workflow:${workspaceId}`]);
    const row = await client.query("SELECT COUNT(*) AS c FROM workflows WHERE workspace_id = $1", [workspaceId]);
    if (Number(row.rows[0].c) >= limit.maxWorkflows) {
      const error = new Error(`Plan limit reached (${limit.maxWorkflows} workflows). Upgrade to add more.`);
      error.status = 403;
      throw error;
    }
    return await callback();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`workflow:${workspaceId}`]).catch(() => {});
    client.release();
  }
}

async function saveExecution(workflowId, result, status, id = uuid(), owner = {}) {
  await db.prepare(
    "INSERT INTO executions (id, workflow_id, user_id, workspace_id, status, log, finished_at) VALUES (?, ?, ?, ?, ?, ?, NOW()) ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, workspace_id = EXCLUDED.workspace_id, status = EXCLUDED.status, log = EXCLUDED.log, finished_at = EXCLUDED.finished_at"
  ).run(id, workflowId, owner.userId || null, owner.workspaceId || null, status, JSON.stringify(result.log || result));
  return id;
}

async function saveWorkflowVersion(workflowId, name, definition) {
  const row = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM workflow_versions WHERE workflow_id = ?").get(workflowId);
  await db.prepare(
    "INSERT INTO workflow_versions (id, workflow_id, version, name, definition) VALUES (?, ?, ?, ?, ?)"
  ).run(uuid(), workflowId, Number(row.version) + 1, name, JSON.stringify(definition));
}

async function workflowInWorkspace(workflowId, workspaceId) {
  if (!workflowId) return true;
  return Boolean(await db.prepare("SELECT id FROM workflows WHERE id = ? AND workspace_id = ?").get(workflowId, workspaceId));
}

// Shared by the manual run endpoint, the public webhook route, and the
// scheduler: runs a workflow, and if it fails AND has an error_workflow_id
// configured, fires that workflow too — passing the original error and
// trigger payload as its input. Mirrors n8n's "Error Trigger workflow" idea,
// without requiring a separate node type.
export async function runWorkflowWithErrorHandling(wf, payload, userId, executionId = uuid()) {
  try {
    const result = await executeWorkflow(JSON.parse(wf.definition), payload, userId, 0, { runId: executionId, workflowId: wf.id, workspaceId: wf.workspace_id });
    const owner = { userId: wf.user_id, workspaceId: wf.workspace_id };
    await saveExecution(wf.id, result, "success", executionId, owner);
    return { ok: true, result };
  } catch (err) {
    const owner = { userId: wf.user_id, workspaceId: wf.workspace_id };
    await saveExecution(wf.id, { log: [{ type: "error", durationMs: 0, error: err.message, output: null }] }, "error", executionId, owner);

    if (wf.error_workflow_id) {
      const errorWf = await db.prepare("SELECT * FROM workflows WHERE id = ? AND workspace_id = ?").get(wf.error_workflow_id, wf.workspace_id);
      if (errorWf) {
        // Fire-and-forget-ish: run it, but don't let a broken error-handler
        // workflow mask the original failure or crash the caller.
        try {
          const errorResult = await executeWorkflow(
            JSON.parse(errorWf.definition),
            { failedWorkflowId: wf.id, failedWorkflowName: wf.name, error: err.message, originalPayload: payload },
            userId,
            0,
            { runId: `${executionId}:error`, workflowId: errorWf.id, workspaceId: errorWf.workspace_id }
          );
          await saveExecution(errorWf.id, errorResult, "success", `${executionId}:error`, { userId: errorWf.user_id, workspaceId: errorWf.workspace_id });
        } catch (nestedErr) {
          await saveExecution(errorWf.id, { log: [{ type: "error", durationMs: 0, error: nestedErr.message, output: null }] }, "error", `${executionId}:error`, { userId: errorWf.user_id, workspaceId: errorWf.workspace_id });
        }
      }
    }
    return { ok: false, error: err.message };
  }
}

router.get("/", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const rows = await db
    .prepare("SELECT id, user_id, name, active, webhook_path, project_id, updated_at FROM workflows WHERE workspace_id = ? ORDER BY updated_at DESC")
    .all(workspaceId);
  const visible = [];
  for (const row of rows) {
    if (await canAccessWorkflow(workspaceId, row.id, req.user.id, "read")) visible.push(row);
  }
  res.json(visible.map(({ user_id, ...row }) => row));
});

router.post("/", requireAuth, async (req, res) => {
  const context = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  const workspaceId = context.id;
  const account = { plan: context.plan };
  const limit = PLAN_LIMITS[account?.plan] || PLAN_LIMITS.free;

  const { name, definition, errorWorkflowId } = req.body;
  const validationError = validateWorkflowInput(name, definition);
  if (validationError) return res.status(400).json({ error: validationError });
  const planError = validatePlanNodes(account?.plan, definition || { nodes: [], edges: [] });
  if (planError) return res.status(403).json({ error: planError });
  if (!(await workflowInWorkspace(errorWorkflowId, workspaceId))) return res.status(400).json({ error: "Error workflow must belong to this workspace" });

  const projectId = req.body.projectId || null;
  if (projectId) {
    const project = await db.prepare("SELECT id FROM projects WHERE id = ? AND workspace_id = ?").get(projectId, workspaceId);
    if (!project) return res.status(400).json({ error: "Project does not belong to this workspace" });
  }
  const id = uuid();
  const webhookPath = uuid().slice(0, 12);
  await withWorkflowQuota(workspaceId, limit, async () => {
    await db.prepare(
      "INSERT INTO workflows (id, user_id, workspace_id, name, definition, webhook_path, error_workflow_id, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, req.user.id, workspaceId, name || "Untitled workflow", JSON.stringify(definition || { nodes: [], edges: [] }), webhookPath, errorWorkflowId || null, projectId);
  });
  await saveWorkflowVersion(id, name || "Untitled workflow", definition || { nodes: [], edges: [] });
  await recordAudit(req.user.id, "workflow.created", "workflow", id, { workspaceId, name: name || "Untitled workflow" });

  res.json({ id, webhookPath });
});

router.get("/:id", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const wf = await db
    .prepare("SELECT * FROM workflows WHERE id = ? AND workspace_id = ?")
    .get(req.params.id, workspaceId);
  if (!wf) return res.status(404).json({ error: "Not found" });
  if (!(await canAccessWorkflow(workspaceId, wf.id, req.user.id, "read"))) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json({ ...wf, accessRole: await getEffectiveWorkflowRole(workspaceId, wf.id, req.user.id), definition: JSON.parse(wf.definition) });
});

router.put("/:id", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const wf = await db
    .prepare("SELECT * FROM workflows WHERE id = ? AND workspace_id = ?")
    .get(req.params.id, workspaceId);
  if (!wf) return res.status(404).json({ error: "Not found" });
  const canWrite = await canAccessWorkflow(workspaceId, wf.id, req.user.id, "write");
  if (!canWrite) return res.status(403).json({ error: "Forbidden" });

  const { name, definition, active, errorWorkflowId, projectId } = req.body;
  const validationError = validateWorkflowInput(name, definition);
  if (validationError) return res.status(400).json({ error: validationError });
  const account = await db.prepare("SELECT u.plan FROM users u JOIN workspaces w ON w.owner_id = u.id WHERE w.id = ?").get(workspaceId);
  const planError = definition ? validatePlanNodes(account?.plan, definition) : null;
  if (planError) return res.status(403).json({ error: planError });
  if (projectId !== undefined && projectId) {
    const project = await db.prepare("SELECT id FROM projects WHERE id = ? AND workspace_id = ?").get(projectId, workspaceId);
    if (!project) return res.status(400).json({ error: "Project does not belong to this workspace" });
  }
  if (errorWorkflowId !== undefined && !(await workflowInWorkspace(errorWorkflowId, workspaceId))) return res.status(400).json({ error: "Error workflow must belong to this workspace" });

  await db.prepare(
    "UPDATE workflows SET name = ?, definition = ?, active = ?, error_workflow_id = ?, project_id = ?, updated_at = NOW() WHERE id = ?"
  ).run(
    name ?? wf.name,
    JSON.stringify(definition ?? JSON.parse(wf.definition)),
    active === undefined ? wf.active : active ? 1 : 0,
    errorWorkflowId !== undefined ? errorWorkflowId || null : wf.error_workflow_id,
    projectId !== undefined ? projectId || null : wf.project_id || null,
    wf.id
  );
  await saveWorkflowVersion(wf.id, name ?? wf.name, definition ?? JSON.parse(wf.definition));
  await recordAudit(req.user.id, "workflow.updated", "workflow", wf.id, { name: name ?? wf.name });
  await syncSchedules();
  res.json({ ok: true });
});

router.get("/:id/permissions", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const workflow = await db.prepare("SELECT id FROM workflows WHERE id = ? AND workspace_id = ?").get(req.params.id, workspaceId);
  if (!workflow || !(await canAccessWorkflow(workspaceId, workflow.id, req.user.id, "read"))) return res.status(404).json({ error: "Not found" });
  const rows = await db.prepare(
    `SELECT wp.user_id, u.email, wp.role, wp.created_at, wp.updated_at
     FROM workflow_permissions wp JOIN users u ON u.id = wp.user_id
     WHERE wp.workflow_id = ? AND wp.workspace_id = ? ORDER BY u.email`
  ).all(workflow.id, workspaceId);
  res.json(rows);
});

router.post("/:id/permissions", requireAuth, async (req, res) => {
  const context = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  if (!hasPlanFeature(context.plan, "workflowPermissions")) return res.status(403).json({ error: "Workflow permissions are available on Pro" });
  if (!['owner', 'admin'].includes(context.role)) return res.status(403).json({ error: "Only owners and admins can manage workflow permissions" });
  const workflow = await db.prepare("SELECT id FROM workflows WHERE id = ? AND workspace_id = ?").get(req.params.id, context.id);
  if (!workflow) return res.status(404).json({ error: "Not found" });
  const { userId, role } = req.body || {};
  if (!userId || !['viewer', 'editor'].includes(role)) return res.status(400).json({ error: "userId and viewer/editor role are required" });
  const member = await db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?").get(context.id, userId);
  if (!member) return res.status(400).json({ error: "User must be a workspace member" });
  await db.prepare(
    `INSERT INTO workflow_permissions (workspace_id, workflow_id, user_id, role)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id, workflow_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`
  ).run(context.id, workflow.id, userId, role);
  await recordAudit(req.user.id, "workflow.permission_changed", "workflow", workflow.id, { workspaceId: context.id, userId, role });
  res.json({ ok: true, userId, role });
});

router.delete("/:id/permissions/:userId", requireAuth, async (req, res) => {
  const context = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  if (!hasPlanFeature(context.plan, "workflowPermissions")) return res.status(403).json({ error: "Workflow permissions are available on Pro" });
  if (!['owner', 'admin'].includes(context.role)) return res.status(403).json({ error: "Only owners and admins can manage workflow permissions" });
  const result = await db.prepare("DELETE FROM workflow_permissions WHERE workspace_id = ? AND workflow_id = ? AND user_id = ?").run(context.id, req.params.id, req.params.userId);
  if (!result.changes) return res.status(404).json({ error: "Permission not found" });
  await recordAudit(req.user.id, "workflow.permission_revoked", "workflow", req.params.id, { workspaceId: context.id, userId: req.params.userId });
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const wf = await db
    .prepare("SELECT id FROM workflows WHERE id = ? AND workspace_id = ?")
    .get(req.params.id, workspaceId);
  if (!wf) return res.status(404).json({ error: "Not found" });
  const canWrite = await canAccessWorkflow(workspaceId, wf.id, req.user.id, "write");
  if (!canWrite) return res.status(403).json({ error: "Forbidden" });

  await db.prepare("DELETE FROM jobs WHERE workflow_id = ?").run(wf.id);
  await db.prepare("DELETE FROM workflows WHERE id = ? AND workspace_id = ?").run(wf.id, workspaceId);
  await recordAudit(req.user.id, "workflow.deleted", "workflow", req.params.id);
  await syncSchedules();
  res.json({ ok: true });
});

router.get("/:id/versions", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const wf = await db.prepare("SELECT id FROM workflows WHERE id = ? AND workspace_id = ?").get(req.params.id, workspaceId);
  if (!wf) return res.status(404).json({ error: "Not found" });
  if (!(await canAccessWorkflow(workspaceId, wf.id, req.user.id, "read"))) {
    return res.status(404).json({ error: "Not found" });
  }
  const rows = await db.prepare(
    "SELECT id, version, name, created_at FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 50"
  ).all(wf.id);
  res.json(rows);
});

router.post("/:id/versions/:version/restore", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const wf = await db.prepare("SELECT * FROM workflows WHERE id = ? AND workspace_id = ?").get(req.params.id, workspaceId);
  if (!wf) return res.status(404).json({ error: "Not found" });
  const canWrite = await canAccessWorkflow(workspaceId, wf.id, req.user.id, "write");
  if (!canWrite) return res.status(403).json({ error: "Forbidden" });
  const version = await db.prepare("SELECT * FROM workflow_versions WHERE workflow_id = ? AND version = ?").get(wf.id, Number(req.params.version));
  if (!version) return res.status(404).json({ error: "Version not found" });
  const definition = JSON.parse(version.definition);
  const account = await db.prepare("SELECT u.plan FROM users u JOIN workspaces w ON w.owner_id = u.id WHERE w.id = ?").get(workspaceId);
  const planError = validatePlanNodes(account?.plan, definition);
  if (planError) return res.status(403).json({ error: planError });
  await db.prepare("UPDATE workflows SET name = ?, definition = ?, updated_at = NOW() WHERE id = ?").run(version.name, version.definition, wf.id);
  await saveWorkflowVersion(wf.id, version.name, definition);
  await syncSchedules();
  res.json({ ok: true, name: version.name, definition });
});

// Manual "run now" for testing in the builder — stays synchronous (not
// queued) because a human is actively watching the builder for the result.
router.post("/:id/run", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const wf = await db
    .prepare("SELECT * FROM workflows WHERE id = ? AND workspace_id = ?")
    .get(req.params.id, workspaceId);
  if (!wf) return res.status(404).json({ error: "Not found" });
  const canWrite = await canAccessWorkflow(workspaceId, wf.id, req.user.id, "write");
  if (!canWrite) return res.status(403).json({ error: "Forbidden" });

  const account = await db.prepare("SELECT u.plan FROM users u JOIN workspaces w ON w.owner_id = u.id WHERE w.id = ?").get(workspaceId);
  try {
    const outcome = await withExecutionQuota(req.user.id, account?.plan, () =>
      runWorkflowWithErrorHandling(wf, req.body.payload || {}, req.user.id)
    );
    if (!outcome.ok) return res.status(500).json({ error: outcome.error });
    res.json(outcome.result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/:id/executions", requireAuth, async (req, res) => {
  let workspaceId;
  try {
    workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  } catch (error) {
    if (error.message === "You do not belong to that workspace") {
      return res.status(404).json({ error: "Not found" });
    }
    throw error;
  }
  const wf = await db
    .prepare("SELECT id FROM workflows WHERE id = ? AND workspace_id = ?")
    .get(req.params.id, workspaceId);
  if (!wf) return res.status(404).json({ error: "Not found" });
  if (!(await canAccessWorkflow(workspaceId, wf.id, req.user.id, "read"))) {
    return res.status(404).json({ error: "Not found" });
  }
  const rows = await db
    .prepare("SELECT id, status, started_at, finished_at FROM executions WHERE workflow_id = ? AND workspace_id = ? ORDER BY started_at DESC LIMIT 50")
    .all(wf.id, workspaceId);
  res.json(rows);
});

router.get("/:id/executions/:execId", requireAuth, async (req, res) => {
  let workspaceId;
  try {
    workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  } catch (error) {
    if (error.message === "You do not belong to that workspace") {
      return res.status(404).json({ error: "Not found" });
    }
    throw error;
  }
  const wf = await db
    .prepare("SELECT id FROM workflows WHERE id = ? AND workspace_id = ?")
    .get(req.params.id, workspaceId);
  if (!wf) return res.status(404).json({ error: "Not found" });
  if (!(await canAccessWorkflow(workspaceId, wf.id, req.user.id, "read"))) {
    return res.status(404).json({ error: "Not found" });
  }
  const row = await db
    .prepare("SELECT * FROM executions WHERE id = ? AND workflow_id = ? AND workspace_id = ?")
    .get(req.params.execId, wf.id, workspaceId);
  if (!row) return res.status(404).json({ error: "Execution not found" });
  res.json({ ...row, log: JSON.parse(row.log) });
});

export default router;
