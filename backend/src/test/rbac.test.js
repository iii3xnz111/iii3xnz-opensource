import { after, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { v4 as uuid } from "uuid";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
let sharedDb;

async function setupWorkspacePair() {
  const { default: db } = await import("../db/index.js");
  sharedDb = db;
  const userA = uuid();
  const userB = uuid();
  const workspaceA = uuid();
  const workspaceB = uuid();

  await db.prepare("INSERT INTO users (id, email, password_hash, plan) VALUES (?, ?, ?, 'free')").run(userA, `${userA}@example.test`, "pw");
  await db.prepare("INSERT INTO users (id, email, password_hash, plan) VALUES (?, ?, ?, 'free')").run(userB, `${userB}@example.test`, "pw");
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)").run(workspaceA, "Workspace A", userA);
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)").run(workspaceB, "Workspace B", userB);
  await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(workspaceA, userA);
  await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')").run(workspaceA, userB);
  await db.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").run(workspaceB, userB);

  const workflowA = uuid();
  const workflowB = uuid();
  await db.prepare("INSERT INTO workflows (id, user_id, workspace_id, name, definition, active, webhook_path) VALUES (?, ?, ?, ?, ?, 1, ?)").run(
    workflowA,
    userA,
    workspaceA,
    "Workflow A",
    JSON.stringify({ nodes: [{ id: "trigger", type: "manualTrigger", data: { config: {} } }], edges: [] }),
    `hook-${uuid().slice(0, 8)}`
  );
  await db.prepare("INSERT INTO workflows (id, user_id, workspace_id, name, definition, active, webhook_path) VALUES (?, ?, ?, ?, ?, 1, ?)").run(
    workflowB,
    userB,
    workspaceB,
    "Workflow B",
    JSON.stringify({ nodes: [{ id: "trigger", type: "manualTrigger", data: { config: {} } }], edges: [] }),
    `hook-${uuid().slice(0, 8)}`
  );

  return { db, userA, userB, workspaceA, workspaceB, workflowA, workflowB };
}

after(async () => {
  if (sharedDb) await sharedDb.pool.end();
});

async function cleanup(ids) {
  const { db, userA, userB, workspaceA, workspaceB, workflowA, workflowB } = ids;
  await db.prepare("DELETE FROM workflow_permissions WHERE workflow_id IN (?, ?)").run(workflowA, workflowB);
  await db.prepare("DELETE FROM workspace_invites WHERE workspace_id IN (?, ?)").run(workspaceA, workspaceB);
  await db.prepare("DELETE FROM workspace_members WHERE workspace_id IN (?, ?)").run(workspaceA, workspaceB);
  await db.prepare("DELETE FROM workflows WHERE id IN (?, ?)").run(workflowA, workflowB);
  await db.prepare("DELETE FROM workspaces WHERE id IN (?, ?)").run(workspaceA, workspaceB);
  await db.prepare("DELETE FROM workspaces WHERE owner_id IN (?, ?)").run(userA, userB);
  await db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(userA, userB);
}

test("user A cannot read user B workflow across workspaces", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const testData = await setupWorkspacePair();
  const { default: workflowRoutes } = await import("../routes/workflows.js");
  const { signToken } = await import("../auth.js");

  const app = express();
  app.use(express.json());
  app.use("/api/workflows", workflowRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = signToken({ id: testData.userA, email: `${testData.userA}@example.test`, plan: "free" });

  try {
    const response = await fetch(`${base}/api/workflows/${testData.workflowB}`, {
      headers: { Authorization: `Bearer ${token}`, "x-workspace-id": testData.workspaceA },
    });
    assert.equal(response.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await cleanup(testData);
  }
});

test("viewer cannot edit workflow", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const testData = await setupWorkspacePair();
  const { default: workflowRoutes } = await import("../routes/workflows.js");
  const { signToken } = await import("../auth.js");
  const { default: db } = await import("../db/index.js");

  await db.prepare("INSERT INTO workflow_permissions (workspace_id, workflow_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'viewer', NOW(), NOW())").run(testData.workspaceA, testData.workflowA, testData.userB);

  const app = express();
  app.use(express.json());
  app.use("/api/workflows", workflowRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = signToken({ id: testData.userB, email: `${testData.userB}@example.test`, plan: "free" });

  try {
    const response = await fetch(`${base}/api/workflows/${testData.workflowA}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-workspace-id": testData.workspaceA },
      body: JSON.stringify({ name: "Nope", definition: { nodes: [], edges: [] } }),
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await cleanup(testData);
  }
});
