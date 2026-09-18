import { test } from "node:test";
import assert from "node:assert/strict";
import { callbackProviderFromState } from "../oauthCallbackPolicy.js";

test("callback provider comes from the validated server-side state row", () => {
  assert.equal(callbackProviderFromState({ provider: "google" }), "google");
  assert.equal(callbackProviderFromState({ provider: "slack" }), "slack");
  assert.throws(() => callbackProviderFromState(null), /no provider/);
});

test("callback provider policy ignores any separate browser-supplied provider value", () => {
  const stateRow = { provider: "google" };
  const browserQuery = { provider: "github" };
  assert.equal(callbackProviderFromState(stateRow), "google");
  assert.notEqual(callbackProviderFromState(stateRow), browserQuery.provider);
});