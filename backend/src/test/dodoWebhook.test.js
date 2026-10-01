import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import { v4 as uuid } from "uuid";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
process.env.DODO_WEBHOOK_SECRET = "whsec_" + Buffer.from("dodo-route-test-secret").toString("base64");
process.env.DODO_PRODUCT_STARTER = "starter-product";
process.env.DODO_PRODUCT_PRO = "pro-product";

function signedHeaders(rawBody, id, timestamp) {
  const secret = Buffer.from("dodo-route-test-secret");
  const signature = crypto.createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}` };
}

async function send(base, event, { id = uuid(), timestamp = Math.floor(Date.now() / 1000), signature = true } = {}) {
  const rawBody = JSON.stringify(event);
  const headers = signature ? signedHeaders(rawBody, id, timestamp) : { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": "v1,invalid" };
  const response = await fetch(base, { method: "POST", headers, body: rawBody });
  return { response, body: await response.text() };
}

test("Dodo route enforces signatures and preserves newer subscription state", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const { default: db } = await import("../db/index.js");
  const { default: dodoWebhookRoutes } = await import("../routes/dodoWebhook.js");
  const userId = uuid();
  await db.prepare("INSERT INTO users (id, email, password_hash, plan) VALUES (?, ?, ?, 'free')").run(userId, `${userId}@example.test`, "test");
  const app = express();
  app.use("/", express.raw({ type: "application/json" }), dodoWebhookRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const newer = Math.floor(Date.now() / 1000);
  const newerEvent = { id: "event-newer", type: "subscription.active", data: { status: "active", product_id: "pro-product", metadata: { userId }, created_at: new Date(newer * 1000).toISOString() } };
  const olderEvent = { id: "event-older", type: "subscription.canceled", data: { status: "canceled", metadata: { userId }, created_at: new Date((newer - 60) * 1000).toISOString() } };
  try {
    assert.equal((await send(base, newerEvent, { id: "event-newer", timestamp: newer })).response.status, 200);
    let user = await db.prepare("SELECT plan, subscription_status FROM users WHERE id = ?").get(userId);
    assert.deepEqual({ plan: user.plan, status: user.subscription_status }, { plan: "pro", status: "active" });

    assert.equal((await send(base, olderEvent, { id: "event-older", timestamp: newer })).response.status, 200);
    user = await db.prepare("SELECT plan, subscription_status FROM users WHERE id = ?").get(userId);
    assert.deepEqual({ plan: user.plan, status: user.subscription_status }, { plan: "pro", status: "active" });

    const duplicate = await send(base, newerEvent, { id: "event-newer", timestamp: newer });
    assert.equal(duplicate.response.status, 200);
    assert.equal((await send(base, newerEvent, { id: "bad-signature", timestamp: newer, signature: false })).response.status, 400);
    assert.equal((await send(base, newerEvent, { id: "stale", timestamp: 1 })).response.status, 400);

    const terminalWithoutProduct = { id: "event-terminal", type: "subscription.expired", data: { status: "expired", metadata: { userId }, created_at: new Date((newer + 60) * 1000).toISOString() } };
    assert.equal((await send(base, terminalWithoutProduct, { id: "event-terminal", timestamp: newer + 60 })).response.status, 200);
    user = await db.prepare("SELECT plan, subscription_status FROM users WHERE id = ?").get(userId);
    assert.deepEqual({ plan: user.plan, status: user.subscription_status }, { plan: "free", status: "expired" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.prepare("DELETE FROM billing_events WHERE user_id = ?").run(userId);
    await db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
});
