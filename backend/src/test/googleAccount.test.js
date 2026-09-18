import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOrCreateGoogleUser } from "../googleAccount.js";

function fakeDb({ linked = null, email = null } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        async get(...params) {
          calls.push({ sql, params });
          if (sql.includes("auth_identities")) return linked;
          return email ? { id: "email-user" } : undefined;
        },
      };
    },
    async transaction(callback) {
      calls.push({ transaction: true });
      return callback({ query: async (sql, params) => calls.push({ sql, params }) });
    },
  };
}

const identity = { subject: "google-sub", email: "new@example.com", name: "New User" };

test("existing Google subject resolves the linked iii3xnz user", async () => {
  const db = fakeDb({ linked: { id: "user-1", email: "linked@example.com", plan: "pro" } });
  const result = await resolveOrCreateGoogleUser(db, identity);
  assert.deepEqual(result, { user: { id: "user-1", email: "linked@example.com", plan: "pro" }, created: false });
});

test("new Google subject creates a passwordless verified account and identity", async () => {
  const db = fakeDb();
  const result = await resolveOrCreateGoogleUser(db, identity);
  assert.equal(result.created, true);
  assert.equal(result.user.email, identity.email);
  assert.equal(result.user.plan, "free");
  assert.ok(db.calls.some((call) => call.transaction));
  assert.ok(db.calls.some((call) => call.sql?.includes("auth_identities")));
});

test("same email without a linked subject returns a conflict instead of merging", async () => {
  const result = await resolveOrCreateGoogleUser(fakeDb({ email: "existing@example.com" }), identity);
  assert.deepEqual(result, { conflict: true });
});

test("new Google account creation can require legal consent before persistence", async () => {
  const db = fakeDb();
  const result = await resolveOrCreateGoogleUser(db, identity, { allowCreate: false });
  assert.deepEqual(result, { legalRequired: true });
  assert.equal(db.calls.some((call) => call.transaction), false);
});