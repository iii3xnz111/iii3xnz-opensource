import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { requireAuth } from "../auth.js";
import { getWorkspaceContext } from "../workspace.js";
import { PLAN_ENTITLEMENTS, PLAN_LIMITS } from "../plan.js";
import { countExecutionsInWindow } from "./workflows.js";
import { recordAudit } from "../audit.js";
import { hasPlanFeature } from "../plan.js";

const DODO_API_URL = process.env.DODO_API_URL || "https://live.dodopayments.com";
const DODO_API_KEY = process.env.DODO_PAYMENTS_API_KEY;
const PRODUCT_IDS = {
  starter: process.env.DODO_PRODUCT_STARTER,
  pro: process.env.DODO_PRODUCT_PRO,
};
const APP_URL = process.env.APP_URL || "http://localhost:5173";

async function dodoRequest(path, options = {}) {
  if (!DODO_API_KEY) throw new Error("DODO_PAYMENTS_API_KEY is not configured");
  const response = await fetch(`${DODO_API_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${DODO_API_KEY}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Dodo Payments request failed (${response.status})`);
  return data;
}

const router = Router();

router.post("/create-checkout-session", requireAuth, async (req, res) => {
  if (process.env.SELF_HOSTED === "true") return res.status(404).json({ error: "Billing is disabled in self-hosted mode" });
  const { plan } = req.body;
  const productId = PRODUCT_IDS[plan];
  if (!productId) return res.status(400).json({ error: "Unknown or unconfigured plan" });

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

  try {
    const session = await dodoRequest("/checkouts", {
      method: "POST",
      body: JSON.stringify({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { email: user.email },
        return_url: `${APP_URL}/account?upgraded=1`,
        metadata: { userId: user.id, plan },
        custom_data: { userId: user.id, plan },
      }),
    });

    res.json({ url: session.checkout_url || session.url });
    await recordAudit(req.user.id, "billing.checkout_started", "subscription", null, { plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/create-portal-session", requireAuth, async (req, res) => {
  if (process.env.SELF_HOSTED === "true") return res.status(404).json({ error: "Billing is disabled in self-hosted mode" });
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user.dodo_customer_id) return res.status(400).json({ error: "No billing account yet" });

  try {
    const session = await dodoRequest("/customer-portal/sessions", {
      method: "POST",
      body: JSON.stringify({ customer_id: user.dodo_customer_id, return_url: `${APP_URL}/account` }),
    });
    res.json({ url: session.url || session.portal_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/status", requireAuth, async (req, res) => {
  if (process.env.SELF_HOSTED === "true") return res.json({ plan: "free", subscription_status: "self_hosted", provider: "self_hosted" });
  const user = await db.prepare("SELECT plan, subscription_status FROM users WHERE id = ?").get(req.user.id);
  res.json({ ...user, provider: "dodo" });
});

router.get("/entitlements", requireAuth, async (req, res) => {
  const user = await db.prepare("SELECT plan FROM users WHERE id = ?").get(req.user.id);
  const plan = PLAN_LIMITS[user?.plan] ? user.plan : "free";
  res.json({ plan, limits: PLAN_LIMITS[plan], features: PLAN_ENTITLEMENTS[plan] });
});

router.get("/usage", requireAuth, async (req, res) => {
  const workspace = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  const user = await db.prepare("SELECT plan FROM users WHERE id = ?").get(req.user.id);
  const plan = PLAN_LIMITS[workspace.plan] ? workspace.plan : "free";
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const countRow = await db.prepare("SELECT COUNT(*) AS c FROM workflows WHERE workspace_id = ?").get(workspace.id);
  const executions = await countExecutionsInWindow(req.user.id, plan, workspace.id);
  res.json({
    plan,
    executions,
    executionWindow: limit.executionWindow,
    maxExecutions: limit.maxExecutions,
    executionsToday: limit.executionWindow === "day" ? executions : undefined,
    maxExecutionsPerDay: limit.executionWindow === "day" ? limit.maxExecutions : undefined,
    workflowCount: Number(countRow.c),
    maxWorkflows: limit.maxWorkflows,
  });
});

router.get("/history", requireAuth, async (req, res) => {
  if (process.env.SELF_HOSTED === "true") return res.json([]);
  const rows = await db.prepare(
    "SELECT id, type, status, amount, currency, description, occurred_at FROM billing_events WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 100"
  ).all(req.user.id);
  res.json(rows);
});

router.get("/activity", requireAuth, async (req, res) => {
  const workspace = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  if (!hasPlanFeature(workspace.plan, "auditLog")) return res.status(403).json({ error: "Audit logs are available on Pro" });
  if (!['owner', 'admin'].includes(workspace.role)) return res.status(403).json({ error: "Only workspace owners and admins can view audit logs" });
  const rows = await db.prepare(
    "SELECT id, user_id, action, resource_type, resource_id, metadata, created_at FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100"
  ).all(workspace.id);
  res.json(rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata || "{}") })));
});

router.get("/operations", requireAuth, async (req, res) => {
  const workspace = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  const [jobs, workflows, executions] = await Promise.all([
    db.prepare("SELECT status, COUNT(*) AS count FROM jobs WHERE workspace_id = ? GROUP BY status").all(workspace.id),
    db.prepare("SELECT COUNT(*) AS count FROM workflows WHERE workspace_id = ?").get(workspace.id),
    db.prepare("SELECT COUNT(*) AS count FROM executions e WHERE e.workspace_id = ? AND e.started_at::timestamptz >= NOW() - INTERVAL '24 hours'").get(workspace.id),
  ]);
  res.json({ jobs: Object.fromEntries(jobs.map((row) => [row.status, Number(row.count)])), workflowCount: Number(workflows.count), executionsLast24Hours: Number(executions.count) });
});

export default router;
