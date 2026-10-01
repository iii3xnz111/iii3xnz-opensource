import { test } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuid } from "uuid";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

async function setupWorkflow(db, { plan = "free", bad = false } = {}) {
  const userId = uuid();
  const workspaceId = uuid();
  const workflowId = uuid();
  await db.prepare("INSERT INTO users (id, email, password_hash, plan) VALUES (?, ?, ?, ?)").run(userId, `${userId}@example.test`, "test", plan);
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)").run(workspaceId, "Queue test", userId);
  await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(workspaceId, userId);
  const definition = {
    nodes: [
      { id: "trigger", type: "manualTrigger", data: { config: {} } },
      { id: "action", type: bad ? "missingNode" : "setVariable", data: { config: { name: "processed", value: "yes" } } },
    ],
    edges: [{ source: "trigger", target: "action" }],
  };
  await db.prepare("INSERT INTO workflows (id, user_id, workspace_id, name, definition) VALUES (?, ?, ?, ?, ?)").run(workflowId, userId, workspaceId, "Queue test", JSON.stringify(definition));
  return { userId, workspaceId, workflowId };
}

async function cleanup(db, ids) {
  await db.prepare("DELETE FROM executions WHERE user_id = ?").run(ids.userId);
  await db.prepare("DELETE FROM jobs WHERE user_id = ?").run(ids.userId);
  await db.prepare("DELETE FROM workflows WHERE id = ?").run(ids.workflowId);
  await db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(ids.workspaceId);
  await db.prepare("DELETE FROM workspaces WHERE id = ?").run(ids.workspaceId);
  await db.prepare("DELETE FROM workspaces WHERE owner_id = ?").run(ids.userId);
  await db.prepare("DELETE FROM users WHERE id = ?").run(ids.userId);
}

test("worker processes a queued job once and persists execution history", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  process.env.NODE_ENV = "test";
  const { default: db } = await import("../db/index.js");
  const { claimNextJob, processJob } = await import("../worker.js");
  const ids = await setupWorkflow(db);
  const jobId = uuid();
  await db.prepare("INSERT INTO jobs (id, workflow_id, user_id, trigger_payload, status, execution_id) VALUES (?, ?, ?, ?, 'pending', ?)").run(jobId, ids.workflowId, ids.userId, "{}", jobId);
  const claimed = await claimNextJob();
  assert.equal(claimed.id, jobId);
  await processJob(claimed);
  const job = await db.prepare("SELECT status, attempts FROM jobs WHERE id = ?").get(jobId);
  const execution = await db.prepare("SELECT status, finished_at, log FROM executions WHERE id = ?").get(jobId);
  assert.deepEqual({ status: job.status, attempts: Number(job.attempts) }, { status: "done", attempts: 1 });
  assert.equal(execution.status, "success");
  assert.ok(execution.finished_at);
  assert.match(execution.log, /"type":"setVariable"/);
  assert.equal(await claimNextJob(), undefined);
  await cleanup(db, ids);
});

test("worker retries failed jobs and records terminal failure after exhaustion", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  process.env.NODE_ENV = "test";
  const { default: db } = await import("../db/index.js");
  const { claimNextJob, processJob } = await import("../worker.js");
  const ids = await setupWorkflow(db, { bad: true });
  const jobId = uuid();
  await db.prepare("INSERT INTO jobs (id, workflow_id, user_id, trigger_payload, status, max_attempts, execution_id) VALUES (?, ?, ?, ?, 'pending', 1, ?)").run(jobId, ids.workflowId, ids.userId, "{}", jobId);
  const claimed = await claimNextJob();
  await processJob(claimed);
  const job = await db.prepare("SELECT status, error, attempts FROM jobs WHERE id = ?").get(jobId);
  const execution = await db.prepare("SELECT status FROM executions WHERE id = ?").get(jobId);
  assert.equal(job.status, "failed");
  assert.equal(Number(job.attempts), 1);
  assert.match(job.error, /Unknown node type/);
  assert.equal(execution.status, "error");
  await cleanup(db, ids);
});

test("worker reclaims stale jobs and scheduler inserts owned queue jobs", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  process.env.NODE_ENV = "test";
  const { default: db } = await import("../db/index.js");
  const { claimNextJob } = await import("../worker.js");
  const { enqueueScheduledWorkflow } = await import("../engine/scheduler.js");
  const ids = await setupWorkflow(db);
  const staleId = uuid();
  await db.prepare("INSERT INTO jobs (id, workflow_id, user_id, trigger_payload, status, started_at, execution_id) VALUES (?, ?, ?, ?, 'running', NOW() - INTERVAL '11 minutes', ?)").run(staleId, ids.workflowId, ids.userId, "{}", staleId);
  const reclaimed = await claimNextJob();
  assert.equal(reclaimed.id, staleId);
  assert.equal(reclaimed.status, "running");
  const scheduledId = await enqueueScheduledWorkflow({ id: ids.workflowId, user_id: ids.userId });
  const scheduled = await db.prepare("SELECT workflow_id, user_id, status FROM jobs WHERE id = ?").get(scheduledId);
  assert.deepEqual(scheduled, { workflow_id: ids.workflowId, user_id: ids.userId, status: "pending" });
  await cleanup(db, ids);
});

test("advisory-lock quota enforcement allows only one concurrent execution at the boundary", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const { default: db } = await import("../db/index.js");
  const { countExecutionsInWindow, withExecutionQuota } = await import("../routes/workflows.js");
  const userId = uuid();
  await db.prepare("INSERT INTO users (id, email, password_hash, plan) VALUES (?, ?, ?, 'free')").run(userId, `${userId}@example.test`, "test");
  await db.pool.query(
    `INSERT INTO executions (id, workflow_id, user_id, status, log)
     SELECT md5(random()::text || clock_timestamp()::text || g::text), md5(random()::text || g::text), $1, 'success', '{}'
     FROM generate_series(1, 249) AS g`,
    [userId]
  );
  const results = await Promise.allSettled([
    withExecutionQuota(userId, "free", async () => {
      await db.prepare("INSERT INTO executions (id, workflow_id, user_id, status, log) VALUES (?, ?, ?, 'success', '{}')").run(uuid(), uuid(), userId);
      return "accepted";
    }),
    withExecutionQuota(userId, "free", async () => {
      await db.prepare("INSERT INTO executions (id, workflow_id, user_id, status, log) VALUES (?, ?, ?, 'success', '{}')").run(uuid(), uuid(), userId);
      return "accepted";
    }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await countExecutionsInWindow(userId, "free"), 250);
  await db.prepare("DELETE FROM executions WHERE user_id = ?").run(userId);
  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});

test("scheduled workflow runs through enqueue, claim, worker, history, and usage", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  process.env.NODE_ENV = "test";
  const { default: db } = await import("../db/index.js");
  const { enqueueScheduledWorkflow, stopSchedules } = await import("../engine/scheduler.js");
  const { claimNextJob, processJob } = await import("../worker.js");
  const ids = await setupWorkflow(db);
  const before = await db.prepare("SELECT COUNT(*) AS c FROM executions WHERE user_id = ?").get(ids.userId);
  const jobId = await enqueueScheduledWorkflow({ id: ids.workflowId, user_id: ids.userId });
  const queued = await db.prepare("SELECT status, workflow_id, user_id FROM jobs WHERE id = ?").get(jobId);
  assert.deepEqual(queued, { status: "pending", workflow_id: ids.workflowId, user_id: ids.userId });
  const claimed = await claimNextJob();
  await processJob(claimed);
  const after = await db.prepare("SELECT COUNT(*) AS c FROM executions WHERE user_id = ?").get(ids.userId);
  const job = await db.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId);
  assert.equal(job.status, "done");
  assert.equal(Number(after.c) - Number(before.c), 1);
  stopSchedules();
  await cleanup(db, ids);
});
