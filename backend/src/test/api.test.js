import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 4111;
const BASE = `http://localhost:${PORT}`;
let serverProcess;
let logBuffer = "";

before(async () => {
  serverProcess = spawn(process.execPath, ["src/server.js"], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(PORT),
      APP_URL: "http://localhost:5173",
      DODO_API_URL: "https://test.dodopayments.com",
      DODO_PAYMENTS_API_KEY: "test_fake",
      DODO_WEBHOOK_SECRET: "whsec_test_fake",
      DODO_PRODUCT_STARTER: "product_fake_starter",
      DODO_PRODUCT_PRO: "product_fake_pro",
      ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
  });
  serverProcess.stdout.on("data", (d) => (logBuffer += d.toString()));
  serverProcess.stderr.on("data", (d) => (logBuffer += d.toString()));

  // Wait for the server to actually be ready rather than a fixed sleep.
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server did not start in time. Log:\n" + logBuffer);
});

after(() => {
  serverProcess.kill();
});

function uniqueEmail() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function signup() {
  const email = uniqueEmail();
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const { token } = await res.json();
  return { token, auth: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
}

async function createWorkflow(auth, name = "workflow under test") {
  const res = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name, definition: { nodes: [], edges: [] } }),
  });
  return (await res.json()).id;
}

test("health check responds", async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
});

test("plan entitlements are upgraded with Starter/Pro value and expanded node access", async () => {
  const { PLAN_LIMITS, PLAN_NODE_TYPES } = await import("../routes/workflows.js");

  assert.equal(PLAN_LIMITS.free.maxWorkflows, 3);
  assert.equal(PLAN_LIMITS.starter.maxWorkflows, 25);
  assert.equal(PLAN_LIMITS.pro.maxWorkflows, 9999);
  assert.ok(PLAN_LIMITS.starter.maxExecutions >= 10000);
  assert.ok(PLAN_LIMITS.pro.maxExecutions >= 100000);
  assert.ok(PLAN_NODE_TYPES.starter.has("googleDriveCreateFile"));
  assert.ok(PLAN_NODE_TYPES.starter.has("microsoftTeamsMessage"));
  assert.ok(PLAN_NODE_TYPES.pro.has("linearCreateIssue"));
  assert.ok(PLAN_NODE_TYPES.pro.has("gmailSendEmail"));
});

test("signup creates an account and returns a token", async () => {
  const email = uniqueEmail();
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.token);
  assert.equal(data.user.email, email);
  assert.equal(data.user.plan, "free");
});

test("signup rejects a duplicate email", async () => {
  const email = uniqueEmail();
  await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const res2 = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert.equal(res2.status, 409);
});

test("login fails with wrong password", async () => {
  const email = uniqueEmail();
  await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "wrongpassword" }),
  });
  assert.equal(res.status, 401);
});

test("OTP flow: extract code from dev-mode log, verify, confirm emailVerified flips", async () => {
  const email = uniqueEmail();
  const signupRes = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const { token } = await signupRes.json();

  // The dev-mode mailer prints the OTP to stdout when APP_SMTP_HOST isn't set.
  await new Promise((r) => setTimeout(r, 200)); // let the log line land
  const match = logBuffer.match(/verification code is: (\d{6})/g);
  const lastMatch = match[match.length - 1];
  const otp = lastMatch.match(/\d{6}/)[0];

  const verifyRes = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ otp }),
  });
  assert.equal(verifyRes.status, 200);

  const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const me = await meRes.json();
  assert.equal(me.emailVerified, true);
});

test("full workflow lifecycle: create, run, check execution history", async () => {
  const email = uniqueEmail();
  const signupRes = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const { token } = await signupRes.json();
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const createRes = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "test workflow",
      definition: {
        nodes: [
          { id: "n1", type: "manualTrigger", data: { config: {} } },
          { id: "n2", type: "setVariable", data: { config: { name: "x", value: "hi-{{input.name}}" } } },
        ],
        edges: [{ source: "n1", target: "n2" }],
      },
    }),
  });
  const { id: workflowId } = await createRes.json();
  assert.ok(workflowId);

  const runRes = await fetch(`${BASE}/api/workflows/${workflowId}/run`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ payload: { name: "world" } }),
  });
  const runResult = await runRes.json();
  assert.equal(runResult.vars.x, "hi-world");

  const historyRes = await fetch(`${BASE}/api/workflows/${workflowId}/executions`, { headers: auth });
  const history = await historyRes.json();
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "success");
});

test("execution history and usage survive a fresh authenticated request", async () => {
  const email = uniqueEmail();
  const password = "password123";
  const signupRes = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await signupRes.json();
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const createRes = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "persistent execution workflow", definition: { nodes: [{ id: "trigger", type: "manualTrigger", data: { config: {} } }], edges: [] } }),
  });
  const { id: workflowId } = await createRes.json();

  await fetch(`${BASE}/api/workflows/${workflowId}/run`, { method: "POST", headers: auth, body: JSON.stringify({ payload: { run: 1 } }) });
  await fetch(`${BASE}/api/workflows/${workflowId}/run`, { method: "POST", headers: auth, body: JSON.stringify({ payload: { run: 2 } }) });

  const meRes = await fetch(`${BASE}/api/auth/me`, { headers: auth });
  const me = await meRes.json();
  assert.equal(me.email, email);

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const relogin = await loginRes.json();
  const freshAuth = { Authorization: `Bearer ${relogin.token}`, "Content-Type": "application/json" };
  const freshMe = await (await fetch(`${BASE}/api/auth/me`, { headers: freshAuth })).json();
  assert.equal(freshMe.id, me.id);

  const history = await (await fetch(`${BASE}/api/workflows/${workflowId}/executions`, { headers: freshAuth })).json();
  assert.equal(history.length, 2);
  const usage = await (await fetch(`${BASE}/api/billing/usage`, { headers: freshAuth })).json();
  assert.equal(usage.executions, 2);
});

test("stale workspace headers cannot expose another user's executions", async () => {
  const firstUser = await signup();
  const secondUser = await signup();

  const firstAuth = firstUser.auth;
  const secondAuth = secondUser.auth;
  const workflowRes = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: firstAuth,
    body: JSON.stringify({ name: "isolated workflow", definition: { nodes: [{ id: "trigger", type: "manualTrigger", data: { config: {} } }], edges: [] } }),
  });
  const { id: workflowId } = await workflowRes.json();
  await fetch(`${BASE}/api/workflows/${workflowId}/run`, { method: "POST", headers: firstAuth, body: JSON.stringify({ payload: { run: 1 } }) });
  await fetch(`${BASE}/api/workflows/${workflowId}/run`, { method: "POST", headers: firstAuth, body: JSON.stringify({ payload: { run: 2 } }) });

  const staleHeader = { ...secondAuth, "X-Workspace-Id": "workspace-that-does-not-belong-to-this-user" };
  const staleHistory = await fetch(`${BASE}/api/workflows/${workflowId}/executions`, { headers: staleHeader });
  assert.equal(staleHistory.status, 404);

  const validHistory = await (await fetch(`${BASE}/api/workflows/${workflowId}/executions`, { headers: firstAuth })).json();
  assert.equal(validHistory.length, 2);
});

test("deleted workflows preserve private execution history and usage after relogin", async () => {
  const email = uniqueEmail();
  const password = "password123";
  const signupRes = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await signupRes.json();
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const workspaceRes = await fetch(`${BASE}/api/workspaces`, { headers: auth });
  const { currentId: workspaceId } = await workspaceRes.json();
  const workflowRes = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: { ...auth, "X-Workspace-Id": workspaceId },
    body: JSON.stringify({ name: "deleted workflow", definition: { nodes: [{ id: "trigger", type: "manualTrigger", data: { config: {} } }], edges: [] } }),
  });
  const { id: deletedWorkflowId } = await workflowRes.json();

  for (let run = 1; run <= 3; run++) {
    const runRes = await fetch(`${BASE}/api/workflows/${deletedWorkflowId}/run`, {
      method: "POST",
      headers: { ...auth, "X-Workspace-Id": workspaceId },
      body: JSON.stringify({ payload: { run } }),
    });
    assert.equal(runRes.status, 200);
  }

  const beforeDeleteHistory = await (await fetch(`${BASE}/api/workflows/${deletedWorkflowId}/executions`, {
    headers: { ...auth, "X-Workspace-Id": workspaceId },
  })).json();
  assert.equal(beforeDeleteHistory.length, 3);

  const deleteRes = await fetch(`${BASE}/api/workflows/${deletedWorkflowId}`, {
    method: "DELETE",
    headers: { ...auth, "X-Workspace-Id": workspaceId },
  });
  assert.equal(deleteRes.status, 200);

  const workflowList = await (await fetch(`${BASE}/api/workflows`, {
    headers: { ...auth, "X-Workspace-Id": workspaceId },
  })).json();
  assert.equal(workflowList.some((workflow) => workflow.id === deletedWorkflowId), false);

  const activeWorkflowRes = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: { ...auth, "X-Workspace-Id": workspaceId },
    body: JSON.stringify({ name: "active workflow", definition: { nodes: [{ id: "trigger", type: "manualTrigger", data: { config: {} } }], edges: [] } }),
  });
  const { id: activeWorkflowId } = await activeWorkflowRes.json();
  const activeRunRes = await fetch(`${BASE}/api/workflows/${activeWorkflowId}/run`, {
    method: "POST",
    headers: { ...auth, "X-Workspace-Id": workspaceId },
    body: JSON.stringify({ payload: { run: "active" } }),
  });
  assert.equal(activeRunRes.status, 200);

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const relogin = await loginRes.json();
  const freshAuth = { Authorization: `Bearer ${relogin.token}`, "Content-Type": "application/json", "X-Workspace-Id": workspaceId };
  const historyRes = await fetch(`${BASE}/api/executions`, { headers: freshAuth });
  const history = await historyRes.json();
  assert.equal(historyRes.status, 200);
  assert.equal(history.length, 4);
  assert.equal(history.filter((execution) => execution.workflow_id === deletedWorkflowId).length, 3);
  assert.equal(history.filter((execution) => execution.workflow_name === "Deleted workflow").length, 3);
  assert.equal(history.filter((execution) => execution.workflow_id === activeWorkflowId).length, 1);

  const usage = await (await fetch(`${BASE}/api/billing/usage`, { headers: freshAuth })).json();
  assert.equal(usage.executions, 4);

  const otherUser = await signup();
  const otherHistory = await (await fetch(`${BASE}/api/executions`, { headers: otherUser.auth })).json();
  assert.equal(otherHistory.length, 0);
});

test("credentials: create, list (never exposes raw secret), delete", async () => {
  const email = uniqueEmail();
  const signupRes = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const { token } = await signupRes.json();
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const createRes = await fetch(`${BASE}/api/credentials`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "Test Cred", type: "githubToken", data: { token: "ghp_realsecret123" } }),
  });
  const created = await createRes.json();
  assert.ok(created.id);

  const listRes = await fetch(`${BASE}/api/credentials`, { headers: auth });
  const list = await listRes.json();
  const listText = JSON.stringify(list);
  assert.ok(!listText.includes("ghp_realsecret123"), "raw secret must never appear in the list response");

  const delRes = await fetch(`${BASE}/api/credentials/${created.id}`, { method: "DELETE", headers: auth });
  assert.equal(delRes.status, 200);
});

test("webhook trigger enqueues a job instead of executing inline", async () => {
  const email = uniqueEmail();
  const signupRes = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const { token } = await signupRes.json();
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const createRes = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "webhook test",
      definition: {
        nodes: [{ id: "n1", type: "webhookTrigger", data: { config: {} } }],
        edges: [],
      },
    }),
  });
  const { id: workflowId, webhookPath } = await createRes.json();
  await fetch(`${BASE}/api/workflows/${workflowId}`, { method: "PUT", headers: auth, body: JSON.stringify({ active: true }) });

  const hookRes = await fetch(`${BASE}/webhook/${webhookPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
  const hookResult = await hookRes.json();
  assert.equal(hookResult.status, "queued");
  assert.ok(hookResult.jobId);
});

test("workflow PUT rejects unauthenticated access", async () => {
  const res = await fetch(`${BASE}/api/workflows/not-authenticated`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "renamed" }),
  });
  assert.equal(res.status, 401);
});

test("workflow PUT renames and persists a workflow", async () => {
  const { auth } = await signup();
  const workflowId = await createWorkflow(auth, "before rename");

  const updateRes = await fetch(`${BASE}/api/workflows/${workflowId}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ name: "after rename" }),
  });
  assert.equal(updateRes.status, 200);

  const getRes = await fetch(`${BASE}/api/workflows/${workflowId}`, { headers: auth });
  const workflow = await getRes.json();
  assert.equal(getRes.status, 200);
  assert.equal(workflow.name, "after rename");
});

test("workflow PUT rejects invalid input", async () => {
  const { auth } = await signup();
  const workflowId = await createWorkflow(auth);

  const res = await fetch(`${BASE}/api/workflows/${workflowId}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ name: 123 }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Name must be a string/);
});

test("workflow PUT cannot rename another user's workflow", async () => {
  const owner = await signup();
  const otherUser = await signup();
  const workflowId = await createWorkflow(owner.auth);

  const res = await fetch(`${BASE}/api/workflows/${workflowId}`, {
    method: "PUT",
    headers: otherUser.auth,
    body: JSON.stringify({ name: "not allowed" }),
  });
  assert.equal(res.status, 404);
});

test("workflow DELETE rejects unauthenticated access", async () => {
  const res = await fetch(`${BASE}/api/workflows/not-authenticated`, { method: "DELETE" });
  assert.equal(res.status, 401);
});

test("workflow DELETE removes an existing workflow", async () => {
  const { auth } = await signup();
  const workflowId = await createWorkflow(auth);

  const deleteRes = await fetch(`${BASE}/api/workflows/${workflowId}`, { method: "DELETE", headers: auth });
  assert.equal(deleteRes.status, 200);
  assert.deepEqual(await deleteRes.json(), { ok: true });

  const getRes = await fetch(`${BASE}/api/workflows/${workflowId}`, { headers: auth });
  assert.equal(getRes.status, 404);
});

test("workflow DELETE returns 404 for a nonexistent workflow", async () => {
  const { auth } = await signup();
  const res = await fetch(`${BASE}/api/workflows/does-not-exist`, { method: "DELETE", headers: auth });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Not found" });
});

test("workflow DELETE cannot delete another user's workflow", async () => {
  const owner = await signup();
  const otherUser = await signup();
  const workflowId = await createWorkflow(owner.auth);

  const res = await fetch(`${BASE}/api/workflows/${workflowId}`, { method: "DELETE", headers: otherUser.auth });
  assert.equal(res.status, 404);

  const ownerGetRes = await fetch(`${BASE}/api/workflows/${workflowId}`, { headers: owner.auth });
  assert.equal(ownerGetRes.status, 200);
});
