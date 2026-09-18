import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSessionToken, ensureJsonResponse } from "../../../frontend/src/session.js";

test("frontend accepts a valid JWT-like backend session response", () => {
  assert.equal(extractSessionToken({ token: "abc.def.ghi" }), "abc.def.ghi");
  assert.equal(extractSessionToken({ accessToken: "abc.def.ghi" }), "abc.def.ghi");
});

test("frontend rejects an empty or error response without faking a valid session", () => {
  assert.throws(() => extractSessionToken({}), /invalid session/i);
  assert.throws(() => extractSessionToken({ error: "Google authentication failed" }), /Google authentication failed/i);
});

test("response guard rejects HTML/non-JSON API responses instead of treating them as a valid session", async () => {
  const res = {
    ok: true,
    headers: { get: () => "text/html; charset=utf-8" },
    json: async () => {
      throw new Error("Unexpected JSON parse");
    },
  };

  await assert.rejects(() => ensureJsonResponse(res, "API"), /unexpected response/i);
});
