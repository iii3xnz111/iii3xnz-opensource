import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { signToken, requireAuth } from "../auth.js";

test("remember me keeps a longer-lived token than a normal browser session", () => {
  const user = { id: "user-1", email: "user@example.test", plan: "free" };

  const sessionToken = signToken(user, { rememberMe: false });
  const persistentToken = signToken(user, { rememberMe: true });

  const sessionPayload = jwt.decode(sessionToken);
  const persistentPayload = jwt.decode(persistentToken);

  assert.equal(typeof sessionPayload, "object");
  assert.equal(typeof persistentPayload, "object");
  assert.ok(persistentPayload.exp > sessionPayload.exp);
  assert.ok(persistentPayload.exp - sessionPayload.exp < 60 * 60 * 24 * 90);
});

test("expired tokens are rejected by the auth middleware", () => {
  const expiredToken = jwt.sign({ id: "user-1", email: "user@example.test", plan: "free" }, process.env.JWT_SECRET || "test-secret", {
    expiresIn: "-1s",
  });

  const fakeReq = { headers: { authorization: `Bearer ${expiredToken}` } };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  let calledNext = false;
  const next = () => { calledNext = true; };

  requireAuth(fakeReq, res, next);

  assert.equal(res.statusCode, 401);
  assert.equal(calledNext, false);
});
