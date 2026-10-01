import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db/index.js";
import { ExecutionLimitError, runWorkflowWithErrorHandling, withExecutionQuota } from "./routes/workflows.js";

const POLL_INTERVAL_MS = 1000;
const STALE_JOB_MINUTES = 10;
const RETRY_DELAYS_SECONDS = [30, 120];

// FOR UPDATE SKIP LOCKED is what makes this safe to run as multiple worker
// processes at once (for real horizontal scaling later): each worker skips
// rows another worker already has locked, instead of blocking on them or
// both processing the same job twice.
export async function claimNextJob() {
  // A process can disappear after claiming a job. Return those jobs to the
  // queue unless they have already exhausted their retry budget.
  await db.pool.query(`
    UPDATE jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        finished_at = CASE WHEN attempts >= max_attempts THEN COALESCE(finished_at, NOW()) ELSE NULL END,
        next_attempt_at = NOW()
    WHERE status = 'running' AND started_at < NOW() - ($1 * INTERVAL '1 minute')
  `, [STALE_JOB_MINUTES]);

  const result = await db.pool.query(`
    UPDATE jobs SET status = 'running', started_at = NOW(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND next_attempt_at <= NOW()
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  return result.rows[0];
}

export async function processJob(job) {
  const wf = await db.prepare("SELECT * FROM workflows WHERE id = ?").get(job.workflow_id);
  if (!wf) {
    await db.prepare(
      "UPDATE jobs SET status = 'failed', error = ?, quota_reserved = 0, finished_at = NOW() WHERE id = ?"
    ).run("Workflow no longer exists", job.id);
    return;
  }

  try {
    const payload = JSON.parse(job.trigger_payload);
    const user = await db.prepare("SELECT plan FROM users WHERE id = ?").get(job.user_id);
    const outcome = await withExecutionQuota(job.user_id, user?.plan, () =>
      runWorkflowWithErrorHandling(wf, payload, job.user_id, job.execution_id || job.id),
      job.id,
      wf.workspace_id
    );
    if (outcome.ok) {
      await db.prepare(
        "UPDATE jobs SET status = 'done', error = NULL, quota_reserved = 0, finished_at = NOW() WHERE id = ?"
      ).run(job.id);
      return;
    }
    await handleFailure(job, outcome.error);
  } catch (err) {
    if (err instanceof ExecutionLimitError) {
      await db.prepare(
        "UPDATE jobs SET status = 'failed', error = ?, quota_reserved = 0, finished_at = NOW() WHERE id = ?"
      ).run(err.message, job.id);
      return;
    }
    await handleFailure(job, err.message);
  }
}

export async function handleFailure(job, error) {
  const canRetry = job.attempts < job.max_attempts;
  const delaySeconds = RETRY_DELAYS_SECONDS[Math.min(job.attempts - 1, RETRY_DELAYS_SECONDS.length - 1)] || 120;
  await db.prepare(
    canRetry
    ? "UPDATE jobs SET status = 'pending', error = ?, next_attempt_at = NOW() + (? * INTERVAL '1 second'), finished_at = NULL WHERE id = ?"
      : "UPDATE jobs SET status = 'failed', error = ?, quota_reserved = 0, finished_at = NOW() WHERE id = ?"
  ).run(...(canRetry ? [error, delaySeconds, job.id] : [error, job.id]));
  console.error(`[worker] job ${job.id} ${canRetry ? `failed; retry ${job.attempts}/${job.max_attempts} scheduled in ${delaySeconds}s` : `permanently failed after ${job.attempts} attempts`}: ${error}`);
}

async function pollLoop() {
  for (;;) {
    try {
      const job = await claimNextJob();
      if (job) {
        console.log(`[worker] processing job ${job.id} (workflow ${job.workflow_id})`);
        await processJob(job);
        continue; // check immediately for another queued job, no need to wait
      }
    } catch (err) {
      console.error("[worker] poll error:", err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

const isWorkerEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (process.env.NODE_ENV === "test") {
  // The worker module is imported by tests for direct function access; it must not
  // start a background polling loop while assertions are running.
} else if (isWorkerEntrypoint) {
  console.log("iii3xnz worker started, polling for jobs...");
  pollLoop();
}
