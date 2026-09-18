import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { PLAN_LIMITS, ExecutionLimitError, withQueuedExecutionQuota } from "./workflows.js";

const router = Router();

// External services POST here: /webhook/:webhookPath
//
// This enqueues a job instead of running the workflow inline. The caller
// (whatever external service fired the webhook) gets an immediate ack —
// it doesn't need or expect to wait for the workflow to finish. The actual
// execution happens in the separate worker process (src/worker.js), so a
// slow or stuck workflow here can never make this API server slow to
// respond to anyone else's request, including other users' webhooks.
router.all("/:webhookPath", async (req, res) => {
  const wf = await db
    .prepare("SELECT * FROM workflows WHERE webhook_path = ? AND active = 1")
    .get(req.params.webhookPath);
  if (!wf) return res.status(404).json({ error: "No active workflow for this webhook" });

  const owner = await db.prepare("SELECT plan FROM users WHERE id = ?").get(wf.user_id);
  const limit = PLAN_LIMITS[owner?.plan] || PLAN_LIMITS.free;

  try {
    const result = await withQueuedExecutionQuota(wf.user_id, owner?.plan, async () => {
      const payload = { query: req.query, body: req.body, headers: req.headers, method: req.method };
      const jobId = uuid();
      const externalEventId = req.headers["idempotency-key"] || req.headers["x-webhook-id"] || req.headers["x-event-id"];
      const dedupeKey = externalEventId ? `${wf.id}:${externalEventId}` : null;
      if (dedupeKey) {
        const existing = await db.prepare("SELECT id FROM jobs WHERE dedupe_key = ?").get(dedupeKey);
        if (existing) return { ok: true, jobId: existing.id, status: "already_queued" };
      }
      await db.prepare(
        "INSERT INTO jobs (id, workflow_id, user_id, workspace_id, trigger_payload, status, dedupe_key, execution_id, quota_reserved) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 1)"
      ).run(jobId, wf.id, wf.user_id, wf.workspace_id, JSON.stringify(payload), dedupeKey, jobId);
      return { ok: true, jobId, status: "queued" };
    }, wf.workspace_id);
    res.json(result);
  } catch (err) {
    if (err instanceof ExecutionLimitError) {
      return res.status(429).json({ error: `${limit.executionWindow === "day" ? "Daily" : "Monthly"} execution limit reached for this account` });
    }
    throw err;
  }
});

export default router;
