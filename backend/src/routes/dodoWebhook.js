import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { isDodoSubscriptionEnding, isValidDodoSignature, normalizeDodoEventTimestamp, resolveDodoPlan } from "../dodoPolicy.js";

const webhookSecret = process.env.DODO_WEBHOOK_SECRET || "";

const router = Router();

router.post("/", async (req, res) => {
  if (process.env.SELF_HOSTED === "true") return res.status(404).json({ error: "Dodo Payments is disabled in self-hosted mode" });
  if (!webhookSecret) return res.status(503).send("DODO_WEBHOOK_SECRET is not configured");
  const webhookId = req.headers["webhook-id"];
  const timestamp = req.headers["webhook-timestamp"];
  const signatureHeader = req.headers["webhook-signature"] || "";
  const timestampSeconds = Number(timestamp);
  if (!webhookId || !timestamp || !Number.isFinite(timestampSeconds)) {
    return res.status(400).send("Webhook timestamp is missing or expired");
  }
  if (!isValidDodoSignature(req.body.toString(), { webhookId, timestamp, signature: signatureHeader }, webhookSecret)) {
    return res.status(400).send(webhookSecret ? "Webhook signature verification failed" : "DODO_WEBHOOK_SECRET is not configured");
  }

  let event;
  try {
    event = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).send("Invalid webhook JSON");
  }
  const data = event.data || event;
  const eventOccurredAt = normalizeDodoEventTimestamp(
    data.created_at || data.created || event.created_at || event.created
  );
  const metadata = data.metadata || data.custom_data || data.subscription?.metadata || data.subscription?.custom_data || {};
  const userId = metadata.userId;
  if (!userId) return res.json({ received: true });

  async function recordEvent() {
    const amount = data.amount ?? data.total_amount ?? data.payment?.amount ?? null;
    const currency = data.currency ?? data.currency_code ?? null;
    const status = data.status || event.type;
    await db.prepare(
      "INSERT INTO billing_events (id, user_id, provider_event_id, type, status, amount, currency, description, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW())) ON CONFLICT (provider_event_id) DO NOTHING"
    ).run(uuid(), userId, event.id || webhookId, event.type || "payment", status, amount, currency, data.product?.name || data.description || null, eventOccurredAt);
  }

  async function setPlan(plan, status) {
    const isPaid = ["active", "trialing", "paid", "succeeded", "completed"].includes(String(status).toLowerCase());
    await db.prepare(
      `UPDATE users
       SET plan = ?, subscription_status = ?,
           dodo_customer_id = COALESCE(?, dodo_customer_id),
           dodo_subscription_id = COALESCE(?, dodo_subscription_id),
           dodo_subscription_event_at = COALESCE(?::timestamptz, dodo_subscription_event_at)
       WHERE id = ?
         AND (dodo_subscription_event_at IS NULL OR ?::timestamptz IS NULL OR dodo_subscription_event_at <= ?::timestamptz)`
    ).run(
      isPaid ? plan : "free", status,
      data.customer_id || data.customer?.customer_id || null,
      data.subscription_id || data.subscription?.subscription_id || null,
      eventOccurredAt, userId, eventOccurredAt, eventOccurredAt
    );
  }

  await recordEvent();
  const eventType = String(event.type || "").toLowerCase();
  const status = data.status || data.subscription?.status || (isDodoSubscriptionEnding(eventType) ? "canceled" : "active");
  if (eventType.includes("subscription") || eventType.includes("checkout") || isDodoSubscriptionEnding(eventType, status)) {
    const productId = data.product_id || data.product?.product_id || data.subscription?.product_id;
    const plan = isDodoSubscriptionEnding(eventType, status)
      ? "free"
      : resolveDodoPlan(productId, process.env.DODO_PRODUCT_STARTER, process.env.DODO_PRODUCT_PRO);
    if (!plan) return res.status(400).send("Unknown Dodo product");
    await setPlan(plan, status);
  }

  res.json({ received: true });
});

export default router;
