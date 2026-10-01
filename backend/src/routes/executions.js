import { Router } from "express";
import db from "../db/index.js";
import { requireAuth } from "../auth.js";
import { canAccessWorkflow, getWorkspaceId } from "../workspace.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  let workspaceId;
  try {
    workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  } catch (error) {
    if (error.message === "You do not belong to that workspace") {
      return res.status(404).json({ error: "Execution history not found" });
    }
    throw error;
  }
  const rows = await db.prepare(
    `SELECT e.id, e.workflow_id, e.user_id, w.id AS live_workflow_id, COALESCE(w.name, 'Deleted workflow') AS workflow_name,
      e.status, e.started_at, e.finished_at
    FROM executions e
    LEFT JOIN workflows w ON w.id = e.workflow_id AND w.workspace_id = e.workspace_id
    WHERE e.workspace_id = ?
    ORDER BY e.started_at DESC
    LIMIT 100`
  ).all(workspaceId);
  const visible = [];
  for (const row of rows) {
    if ((!row.live_workflow_id && row.user_id === req.user.id) || (row.live_workflow_id && await canAccessWorkflow(workspaceId, row.workflow_id, req.user.id, "read"))) visible.push(row);
  }
  res.json(visible.map(({ user_id, live_workflow_id, ...row }) => row));
});

router.get("/:id", requireAuth, async (req, res) => {
  let workspaceId;
  try {
    workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  } catch (error) {
    if (error.message === "You do not belong to that workspace") {
      return res.status(404).json({ error: "Execution not found" });
    }
    throw error;
  }
  const row = await db.prepare(
    `SELECT e.*, COALESCE(w.name, 'Deleted workflow') AS workflow_name
    FROM executions e
    LEFT JOIN workflows w ON w.id = e.workflow_id AND w.workspace_id = e.workspace_id
    WHERE e.id = ? AND e.workspace_id = ?`
  ).get(req.params.id, workspaceId);
  if (!row) return res.status(404).json({ error: "Execution not found" });
  if (row.workflow_id && !(await canAccessWorkflow(workspaceId, row.workflow_id, req.user.id, "read"))) return res.status(404).json({ error: "Execution not found" });
  res.json({ ...row, log: JSON.parse(row.log) });
});

export default router;
