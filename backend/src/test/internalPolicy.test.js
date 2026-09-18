import { test } from "node:test";
import assert from "node:assert/strict";
import { internalQueueAuthError } from "../internalPolicy.js";

test("internal queue requires a configured matching secret", () => {
  assert.equal(internalQueueAuthError(undefined, "anything"), "missing");
  assert.equal(internalQueueAuthError("expected", undefined), "unauthorized");
  assert.equal(internalQueueAuthError("expected", "wrong"), "unauthorized");
  assert.equal(internalQueueAuthError("expected", "expected"), null);
});