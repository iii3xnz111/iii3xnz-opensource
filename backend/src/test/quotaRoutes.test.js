import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { v4 as uuid } from "uuid";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

async function setupExecutionLimitUser(db, { workflowCount = 1 } = {}) {
  const userId = uuid();
  const workspaceId = uuid();
  const workflowIds = [];
  await db.prepare("INSERT INTO users (id, email, password_hash, plan) VALUES (?, ?, ?, 'free')").run(userId, `${userId}@example.test`, "test");
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?) ").run(workspaceId, "Quota workspace", userId);
  await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(workspaceId, userId);
  for (let i = 0; i < workflowCount; i++) {
    const workflowId = uuid();
    await db.prepare("INSERT INTO workflows (id, user_id, workspace_id, name, definition, active, webhook_path) VALUES (?, ?, ?, ?, ?, 1, ?) ").run(
      workflowId,
      userId,
      workspaceId,
      `Workflow ${i}`,
      JSON.stringify({ nodes: [{ id: "trigger", type: "manualTrigger", data: { config: {} } }, { id: "action", type: "setVariable", data: { config: { name: "value", value: "ok" } } }], edges: [{ source: "trigger", target: "action" }] }),
      `hook-${uuid().slice(0, 8)}`
    );
    workflowIds.push(workflowId);
  }

  await db.pool.query(
    `INSERT INTO executions (id, workflow_id, user_id, workspace_id, status, log)
     SELECT md5(random()::text || clock_timestamp()::text || g::text), $1, $2, $3, 'success', '{}'
     FROM generate_series(1, 249) AS g`,
    [workflowIds[0], userId, workspaceId]
  );

  return { userId, workspaceId, workflowIds };
}

async function cleanupExecutionLimitUser(db, userId, workspaceId, workflowIds = []) {
  await db.prepare("DELETE FROM executions WHERE user_id = ?").run(userId);
  await db.prepare("DELETE FROM jobs WHERE user_id = ?").run(userId);
  for (const workflowId of workflowIds) {
    await db.prepare("DELETE FROM workflows WHERE id = ?").run(workflowId);
  }
  await db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").run(workspaceId);
  await db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  await db.prepare("DELETE FROM workspaces WHERE owner_id = ?").run(userId);
  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

test("manual execution route blocks a concurrent quota bypass", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const { default: db } = await import("../db/index.js");
  const { default: workflowRoutes } = await import("../routes/workflows.js");
  const { signToken } = await import("../auth.js");
  const { userId, workspaceId, workflowIds } = await setupExecutionLimitUser(db);
  const app = express();
  app.use(express.json());
  app.use("/api/workflows", workflowRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = signToken({ id: userId, email: `${userId}@example.test`, plan: "free" });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-workspace-id": workspaceId };

  try {
    const results = await Promise.allSettled([
      fetch(`${base}/api/workflows/${workflowIds[0]}/run`, { method: "POST", headers, body: JSON.stringify({ payload: { run: 1 } }) }),
      fetch(`${base}/api/workflows/${workflowIds[0]}/run`, { method: "POST", headers, body: JSON.stringify({ payload: { run: 2 } }) }),
    ]);
    const accepted = results.filter((result) => result.status === "fulfilled" && result.value.status === 200).length;
    assert.equal(accepted, 1);
    const count = Number((await db.prepare("SELECT COUNT(*) AS c FROM executions WHERE user_id = ?").get(userId)).c);
    assert.equal(count, 250);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await cleanupExecutionLimitUser(db, userId, workspaceId, workflowIds);
  }
});

test("webhook-triggered route blocks a concurrent quota bypass", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const { default: db } = await import("../db/index.js");
  const { default: webhookRoutes } = await import("../routes/webhooks.js");
  const { userId, workspaceId, workflowIds } = await setupExecutionLimitUser(db);
  const app = express();
  app.use(express.json());
  app.use("/webhook", webhookRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const workflowId = workflowIds[0];
  const webhookPath = `quota-${uuid().slice(0, 12)}`;
  await db.prepare("UPDATE workflows SET active = 1, webhook_path = ? WHERE id = ?").run(webhookPath, workflowId);

  try {
    const results = await Promise.allSettled([
      fetch(`${base}/webhook/${webhookPath}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "req-1" }, body: JSON.stringify({ ping: 1 }) }),
      fetch(`${base}/webhook/${webhookPath}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "req-2" }, body: JSON.stringify({ ping: 2 }) }),
    ]);
    const accepted = results.filter((result) => result.status === "fulfilled" && result.value.status === 200).length;
    assert.equal(accepted, 1);
    const queued = await db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE workflow_id = ?").get(workflowId);
    assert.equal(Number(queued.c), 1);
    const count = Number((await db.prepare("SELECT COUNT(*) AS c FROM executions WHERE user_id = ?").get(userId)).c);
    assert.equal(count, 249);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await cleanupExecutionLimitUser(db, userId, workspaceId, workflowIds);
  }
});

test("scheduled queue insertion blocks a concurrent quota bypass", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const { default: db } = await import("../db/index.js");
  const { enqueueScheduledWorkflow, stopSchedules } = await import("../engine/scheduler.js");
  const { claimNextJob, processJob } = await import("../worker.js");
  const { userId, workspaceId, workflowIds } = await setupExecutionLimitUser(db);
  const workflowId = workflowIds[0];

  try {
    const results = await Promise.allSettled([
      enqueueScheduledWorkflow({ id: workflowId, user_id: userId }),
      enqueueScheduledWorkflow({ id: workflowId, user_id: userId }),
    ]);
    const accepted = results.filter((result) => result.status === "fulfilled").length;
    assert.equal(accepted, 1);
    const tasks = await db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE workflow_id = ? AND user_id = ?").get(workflowId, userId);
    assert.equal(Number(tasks.c), 1);
    const job = await claimNextJob();
    await processJob(job);
    const count = Number((await db.prepare("SELECT COUNT(*) AS c FROM executions WHERE user_id = ?").get(userId)).c);
    assert.equal(count, 250);
  } finally {
    stopSchedules();
    await cleanupExecutionLimitUser(db, userId, workspaceId, workflowIds);
  }
});
