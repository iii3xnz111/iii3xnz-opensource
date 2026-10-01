import { test } from "node:test";
import assert from "node:assert/strict";
import { v4 as uuid } from "uuid";
import { executeWorkflow } from "../engine/executeWorkflow.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

async function setup() {
  const { default: db } = await import("../db/index.js");
  const userId = uuid();
  const workflowId = uuid();
  await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(userId, `${userId}@example.test`, "test");
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)").run(uuid(), "Merge test", userId);
  await db.prepare("INSERT INTO workflows (id, user_id, name, definition) VALUES (?, ?, ?, ?)").run(workflowId, userId, "Merge test", JSON.stringify({ nodes: [], edges: [] }));
  return { db, userId, workflowId };
}

function definition() {
  return {
    nodes: [
      { id: "trigger", type: "manualTrigger", data: { config: {} } },
      { id: "left", type: "setVariable", data: { config: { name: "left", value: "L" } } },
      { id: "right", type: "setVariable", data: { config: { name: "right", value: "R" } } },
      { id: "merge", type: "merge", data: { config: { mode: "waitForAll" } } },
      { id: "after", type: "setVariable", data: { config: { name: "continued", value: "yes" } } },
    ],
    edges: [
      { source: "trigger", target: "left" },
      { source: "trigger", target: "right" },
      { source: "left", target: "merge" },
      { source: "right", target: "merge" },
      { source: "merge", target: "after" },
    ],
  };
}

test("persisted Merge waits for all branches and has one continuation claim", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const { db, userId, workflowId } = await setup();
  const runId = uuid();
  const results = await Promise.all([
    executeWorkflow(definition(), {}, userId, 0, { runId, workflowId }),
    executeWorkflow(definition(), {}, userId, 0, { runId, workflowId }),
  ]);
  const continuedRuns = results.filter((result) => result.vars.continued === "yes");
  assert.equal(continuedRuns.length, 1, JSON.stringify(results.map((result) => result.vars)));
  const state = await db.prepare("SELECT status, completed_sources, outputs FROM merge_states WHERE execution_id = ? AND merge_node_id = ?").get(runId, "merge");
  assert.equal(state.status, "completed");
  assert.deepEqual(new Set(JSON.parse(state.completed_sources)), new Set(["left", "right"]));
  assert.deepEqual(Object.keys(JSON.parse(state.outputs)).sort(), ["left", "right"]);
  await db.prepare("DELETE FROM merge_states WHERE execution_id = ?").run(runId);
  await db.prepare("DELETE FROM workflows WHERE id = ?").run(workflowId);
  await db.prepare("DELETE FROM workspaces WHERE owner_id = ?").run(userId);
  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});

test("stale Merge claims are reclaimable after a worker restart", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const { db, userId, workflowId } = await setup();
  const runId = uuid();
  await db.prepare("INSERT INTO merge_states (execution_id, workflow_id, merge_node_id, required_sources, completed_sources, outputs, status, claimed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'running', NOW() - INTERVAL '11 minutes', NOW() + INTERVAL '5 minutes')").run(runId, workflowId, "merge", JSON.stringify(["left", "right"]), JSON.stringify(["left", "right"]), JSON.stringify({ left: {}, right: {} }));
  const result = await executeWorkflow(definition(), {}, userId, 0, { runId, workflowId });
  assert.equal(result.vars.continued, "yes");
  const state = await db.prepare("SELECT status FROM merge_states WHERE execution_id = ? AND merge_node_id = ?").get(runId, "merge");
  assert.equal(state.status, "completed");
  await db.prepare("DELETE FROM merge_states WHERE execution_id = ?").run(runId);
  await db.prepare("DELETE FROM workflows WHERE id = ?").run(workflowId);
  await db.prepare("DELETE FROM workspaces WHERE owner_id = ?").run(userId);
  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});

test("failed fan-in branches do not continue Merge", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const { db, userId, workflowId } = await setup();
  const runId = uuid();
  const failedDefinition = definition();
  failedDefinition.nodes.find((node) => node.id === "right").type = "missingNode";
  await assert.rejects(() => executeWorkflow(failedDefinition, {}, userId, 0, { runId, workflowId }), /Unknown node type/);
  const state = await db.prepare("SELECT status, completed_sources FROM merge_states WHERE execution_id = ? AND merge_node_id = ?").get(runId, "merge");
  assert.equal(state.status, "waiting");
  assert.deepEqual(JSON.parse(state.completed_sources), ["left"]);
  await db.prepare("DELETE FROM merge_states WHERE execution_id = ?").run(runId);
  await db.prepare("DELETE FROM workflows WHERE id = ?").run(workflowId);
  await db.prepare("DELETE FROM workspaces WHERE owner_id = ?").run(userId);
  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});
