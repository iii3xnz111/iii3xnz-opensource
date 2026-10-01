import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { isDodoSubscriptionEnding, isValidDodoSignature, normalizeDodoEventTimestamp, resolveDodoPlan } from "../dodoPolicy.js";

test("Dodo signatures require the exact body and a fresh timestamp", () => {
  const rawBody = JSON.stringify({ type: "subscription.active" });
  const webhookId = "webhook-test-1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = Buffer.from("test-signing-secret").toString("base64");
  const signature = crypto.createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${webhookId}.${timestamp}.${rawBody}`)
    .digest("base64");
  const headers = { webhookId, timestamp, signature: `v1,${signature}` };

  assert.equal(isValidDodoSignature(rawBody, headers, `whsec_${secret}`), true);
  assert.equal(isValidDodoSignature(`${rawBody} `, headers, `whsec_${secret}`), false);
  assert.equal(isValidDodoSignature(rawBody, { ...headers, timestamp: "1" }, `whsec_${secret}`), false);
});

test("Dodo product resolution never defaults unknown products to a paid plan", () => {
  assert.equal(resolveDodoPlan("starter-product", "starter-product", "pro-product"), "starter");
  assert.equal(resolveDodoPlan("pro-product", "starter-product", "pro-product"), "pro");
  assert.equal(resolveDodoPlan("unknown-product", "starter-product", "pro-product"), null);
});

test("terminal subscription events can downgrade without a product id", () => {
  assert.equal(isDodoSubscriptionEnding("subscription.canceled"), true);
  assert.equal(isDodoSubscriptionEnding("subscription.expired", "active"), true);
  assert.equal(isDodoSubscriptionEnding("subscription.updated", "past_due"), true);
  assert.equal(isDodoSubscriptionEnding("subscription.updated", "on_hold"), true);
  assert.equal(isDodoSubscriptionEnding("payment.failed"), true);
  assert.equal(isDodoSubscriptionEnding("subscription.active", "active"), false);
});

test("Dodo event timestamps normalize valid values and reject invalid ordering data", () => {
  assert.equal(normalizeDodoEventTimestamp("2026-01-02T03:04:05Z"), "2026-01-02T03:04:05.000Z");
  assert.equal(normalizeDodoEventTimestamp("not-a-timestamp"), null);
  assert.equal(normalizeDodoEventTimestamp(null), null);
});