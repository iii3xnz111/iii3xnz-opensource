import express from "express";
import db from "../db/index.js";
import { ExecutionLimitError, runWorkflowWithErrorHandling, withExecutionQuota } from "./workflows.js";
import { internalQueueAuthError } from "../internalPolicy.js";

const STALE_JOB_MINUTES = 10;
const RETRY_DELAYS_SECONDS = [30, 120];
const MAX_DURATION_MS = 25000;
const MAX_JOBS_PER_RUN = 25;

async function claimNextJob() {
  await db.pool.query(
    `
      UPDATE jobs
      SET
        status = CASE
          WHEN attempts >= max_attempts THEN 'failed'
          ELSE 'pending'
        END,
        finished_at = CASE
          WHEN attempts >= max_attempts THEN COALESCE(finished_at, NOW())
          ELSE NULL
        END,
        next_attempt_at = NOW()
      WHERE status = 'running'
        AND started_at < NOW() - ($1 * INTERVAL '1 minute')
    `,
    [STALE_JOB_MINUTES]
  );

  const result = await db.pool.query(`
    UPDATE jobs
    SET
      status = 'running',
      started_at = NOW(),
      attempts = attempts + 1
    WHERE id = (
      SELECT id
      FROM jobs
      WHERE status = 'pending'
        AND next_attempt_at <= NOW()
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  return result.rows[0];
}

async function handleFailure(job, error) {
  const canRetry = job.attempts < job.max_attempts;

  const delaySeconds =
    RETRY_DELAYS_SECONDS[
      Math.min(job.attempts - 1, RETRY_DELAYS_SECONDS.length - 1)
    ] || 120;

  await db.prepare(
    canRetry
      ? `UPDATE jobs
         SET status = 'pending',
             error = ?,
             quota_reserved = 0,
             next_attempt_at = NOW() + (? * INTERVAL '1 second'),
             finished_at = NULL
         WHERE id = ?`
      : `UPDATE jobs
         SET status = 'failed',
             error = ?,
             quota_reserved = 0,
             finished_at = NOW()
         WHERE id = ?`
  ).run(
    ...(canRetry
      ? [error, delaySeconds, job.id]
      : [error, job.id])
  );

  console.error(
    `[queue] job ${job.id} ${
      canRetry
        ? `failed; retry ${job.attempts}/${job.max_attempts} scheduled in ${delaySeconds}s`
        : `permanently failed after ${job.attempts} attempts`
    }: ${error}`
  );
}

async function processJob(job) {
  const wf = await db
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(job.workflow_id);

  if (!wf) {
    await db
      .prepare(
        `UPDATE jobs
         SET status = 'failed',
             error = ?,
             finished_at = NOW()
         WHERE id = ?`
      )
      .run("Workflow no longer exists", job.id);

    return;
  }

  try {
    const payload = JSON.parse(job.trigger_payload);
    const user = await db.prepare("SELECT plan FROM users WHERE id = ?").get(job.user_id);

    const outcome = await withExecutionQuota(job.user_id, user?.plan, () =>
        runWorkflowWithErrorHandling(
        wf,
        payload,
        job.user_id,
        job.execution_id || job.id
      ),
      job.id,
      wf.workspace_id
    );

    if (outcome.ok) {
      await db
        .prepare(
          `UPDATE jobs
           SET status = 'done',
               error = NULL,
               quota_reserved = 0,
               finished_at = NOW()
           WHERE id = ?`
        )
        .run(job.id);

      return;
    }

    await handleFailure(job, outcome.error);
  } catch (err) {
    if (err instanceof ExecutionLimitError) {
      await db
        .prepare(
          `UPDATE jobs
           SET status = 'failed',
               error = ?,
               quota_reserved = 0,
               finished_at = NOW()
           WHERE id = ?`
        )
        .run(err.message, job.id);
      return;
    }
    await handleFailure(job, err.message);
  }
}

const router = express.Router();

router.get("/process-queue", async (req, res) => {
  const secret = process.env.INTERNAL_CRON_SECRET;

  const suppliedSecret = req.get("x-internal-cron-secret");

  const authError = internalQueueAuthError(secret, suppliedSecret);
  if (authError === "missing") {
    return res.status(503).json({ error: "internal queue secret is not configured" });
  }
  if (authError === "unauthorized") {
    return res.status(401).json({ error: "unauthorized" });
  }

  const start = Date.now();
  let processed = 0;

  try {
    while (
      Date.now() - start < MAX_DURATION_MS &&
      processed < MAX_JOBS_PER_RUN
    ) {
      const job = await claimNextJob();

      if (!job) break;

      console.log(
        `[queue] processing job ${job.id} (workflow ${job.workflow_id})`
      );

      await processJob(job);
      processed++;
    }

    res.json({
      ok: true,
      processed
    });
  } catch (err) {
    console.error("[queue] error:", err.message);
    res.status(500).json({ error: "internal error" });
  }
});

export default router;
