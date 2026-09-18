import { test } from "node:test";
import assert from "node:assert/strict";

const live = process.env.RUN_LIVE_INTEGRATION_TESTS === "true";
const allowlistedEnvironment = process.env.LIVE_INTEGRATION_ENV === "sandbox" || process.env.LIVE_INTEGRATION_ENV === "test";
const enabled = live && allowlistedEnvironment;

function requireConfig(...names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing live integration configuration: ${missing.join(", ")}`);
}

function liveTest(name, config, fn) {
  test(name, { skip: !enabled ? "Set RUN_LIVE_INTEGRATION_TESTS=true and LIVE_INTEGRATION_ENV=sandbox or test" : false }, async () => {
    requireConfig(...config);
    await fn();
  });
}

liveTest("GitHub live connection smoke test", ["LIVE_GITHUB_TOKEN", "LIVE_GITHUB_REPOSITORY"], async () => {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(process.env.LIVE_GITHUB_REPOSITORY)}`, {
    headers: { Authorization: `Bearer ${process.env.LIVE_GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "iii3xnz-live-test" },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.ok, true);
});

liveTest("Stripe live account smoke test", ["LIVE_STRIPE_SECRET_KEY"], async () => {
  const response = await fetch("https://api.stripe.com/v1/account", {
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.LIVE_STRIPE_SECRET_KEY}:`).toString("base64")}` },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.ok, true);
});

liveTest("Slack live authentication smoke test", ["LIVE_SLACK_TOKEN"], async () => {
  const response = await fetch("https://slack.com/api/auth.test", {
    headers: { Authorization: `Bearer ${process.env.LIVE_SLACK_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  assert.equal(response.ok && data.ok, true);
});

liveTest("Google, Microsoft, HubSpot, Shopify, and Teams live tests require provider-specific sandbox resources", ["LIVE_PROVIDER_ACKNOWLEDGED"], async () => {
  assert.equal(process.env.LIVE_PROVIDER_ACKNOWLEDGED, "true");
});
