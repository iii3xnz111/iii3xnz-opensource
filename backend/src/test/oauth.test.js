import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizationUrl, createOAuthState, createPkcePair, hashOAuthState, listOAuthProviders } from "../oauth.js";
import { refreshOAuthTokens } from "../oauthConnections.js";
import { v4 as uuid } from "uuid";

process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
for (const name of [
  "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
  "SLACK_OAUTH_CLIENT_ID", "SLACK_OAUTH_CLIENT_SECRET",
  "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET",
  "MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET",
  "HUBSPOT_OAUTH_CLIENT_ID", "HUBSPOT_OAUTH_CLIENT_SECRET",
]) process.env[name] = `test-${name.toLowerCase()}`;

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("OAuth provider metadata and PKCE authorization URLs are server-configured", () => {
  const providers = listOAuthProviders();
  assert.deepEqual(providers.map((provider) => provider.id), ["google", "slack", "github", "microsoft", "hubspot"]);
  const { verifier, challenge } = createPkcePair();
  const state = createOAuthState();
  const url = new URL(buildAuthorizationUrl("google", state, challenge));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(url.searchParams.get("state"), state);
  assert.equal(hashOAuthState(state).length, 64);
  assert.ok(verifier.length >= 43);
  assert.equal(url.searchParams.has("client_secret"), false);
});

test("OAuth refresh exchanges only server-side token data and preserves no response secret in errors", async () => {
  let request;
  const refreshed = await refreshOAuthTokens("github", { refresh_token: "refresh-test" }, async (url, options) => {
    request = { url, options };
    return response({ access_token: "access-test", expires_in: 3600, scope: "read:user" });
  });
  assert.equal(refreshed.access_token, "access-test");
  assert.match(request.url, /github\.com\/login\/oauth\/access_token/);
  assert.match(request.options.body, /grant_type=refresh_token/);
  assert.match(request.options.body, /refresh_token=refresh-test/);
  assert.doesNotMatch(request.options.body, /access-test/);
});

test("OAuth refresh returns null for provider rejection", async () => {
  const result = await refreshOAuthTokens("google", { refresh_token: "refresh-test" }, async () => response({ error: "invalid_grant" }, 400));
  assert.equal(result, null);
});

test("OAuth connection tokens are encrypted and ownership-scoped", { skip: !process.env.DATABASE_URL ? "DATABASE_URL is required" : false }, async () => {
  const { default: db } = await import("../db/index.js");
  const { createOAuthConnection, resolveOAuthCredential } = await import("../oauthConnections.js");
  const userId = uuid();
  const otherUserId = uuid();
  const workspaceId = uuid();
  const otherWorkspaceId = uuid();
  await db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?), (?, ?, ?)").run(userId, `${userId}@example.test`, "test", otherUserId, `${otherUserId}@example.test`, "test");
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)").run(workspaceId, "OAuth test", userId);
  await db.prepare("INSERT INTO workspaces (id, name, owner_id) VALUES (?, ?, ?)").run(otherWorkspaceId, "Other OAuth workspace", userId);
  const connection = await createOAuthConnection({ userId, workspaceId, provider: "github", identity: { id: `account-${userId}`, label: "Test account" }, tokenData: { access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600 }, scopes: ["read:user"] });
  const stored = await db.prepare("SELECT encrypted_tokens FROM oauth_connections WHERE id = ?").get(connection.id);
  assert.doesNotMatch(stored.encrypted_tokens, /access-secret|refresh-secret/);
  const resolved = await resolveOAuthCredential(userId, connection.id);
  assert.equal(resolved.token, "access-secret");
  await assert.rejects(() => resolveOAuthCredential(otherUserId, connection.id), /OAuth connection not found/);
  await assert.rejects(() => resolveOAuthCredential(userId, connection.id, otherWorkspaceId), /OAuth connection not found/);
  await db.prepare("DELETE FROM oauth_connections WHERE id = ?").run(connection.id);
  await db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
  await db.prepare("DELETE FROM workspaces WHERE id = ?").run(otherWorkspaceId);
  await db.prepare("DELETE FROM users WHERE id IN (?, ?)").run(userId, otherUserId);
});
