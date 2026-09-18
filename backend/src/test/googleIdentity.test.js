import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGoogleIdToken } from "../googleIdentity.js";

process.env.GOOGLE_AUTH_CLIENT_ID = "test-google-client-id";

function tokenPayload(overrides = {}) {
  return {
    iss: "https://accounts.google.com",
    sub: "google-sub-123",
    email: "person@example.com",
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

function verifier(payload) {
  return async (idToken, audience) => {
    assert.equal(idToken, "synthetic-id-token");
    assert.equal(audience, "test-google-client-id");
    return payload;
  };
}

test("valid Google ID token returns the stable sub identity", async () => {
  const identity = await verifyGoogleIdToken("synthetic-id-token", verifier(tokenPayload({ name: "Person" })));
  assert.deepEqual(identity, { subject: "google-sub-123", email: "person@example.com", name: "Person" });
});

test("Google ID token rejects wrong issuer, unverified email, expired token, and missing subject", async () => {
  await assert.rejects(() => verifyGoogleIdToken("synthetic-id-token", verifier(tokenPayload({ iss: "https://evil.example" }))), /issuer/);
  await assert.rejects(() => verifyGoogleIdToken("synthetic-id-token", verifier(tokenPayload({ email_verified: false }))), /not verified/);
  await assert.rejects(() => verifyGoogleIdToken("synthetic-id-token", verifier(tokenPayload({ exp: Math.floor(Date.now() / 1000) - 1 }))), /expired/);
  await assert.rejects(() => verifyGoogleIdToken("synthetic-id-token", verifier(tokenPayload({ sub: "" }))), /subject/);
});

test("Google verifier rejects wrong audience and malformed credentials", async () => {
  await assert.rejects(() => verifyGoogleIdToken("synthetic-id-token", async () => { throw new Error("Wrong audience"); }), /Wrong audience/);
  await assert.rejects(() => verifyGoogleIdToken("", verifier(tokenPayload())), /required/);
});
