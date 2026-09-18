import crypto from "crypto";

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export function isValidDodoSignature(rawBody, { webhookId, timestamp, signature }, webhookSecret, now = Date.now()) {
  const timestampSeconds = Number(timestamp);
  if (!webhookSecret || !webhookId || !timestamp || !Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Math.floor(now / 1000) - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  let secret;
  try {
    secret = Buffer.from(webhookSecret.replace(/^whsec_/, ""), "base64");
    if (!secret.length) return false;
  } catch {
    return false;
  }

  const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedContent).digest("base64");
  return String(signature || "").split(" ").some((value) => {
    const actual = Buffer.from(value.replace(/^v1,/, ""));
    const expectedBuffer = Buffer.from(expected);
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
  });
}

export function resolveDodoPlan(productId, starterProductId, proProductId) {
  if (productId && productId === starterProductId) return "starter";
  if (productId && productId === proProductId) return "pro";
  return null;
}

export function isDodoSubscriptionEnding(eventType, status) {
  const value = `${String(eventType || "")} ${String(status || "")}`.toLowerCase();
  return /cancel|expire|past_due|unpaid|on[_-]?hold|paused|fail|declin|reject/.test(value);
}

export function normalizeDodoEventTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}