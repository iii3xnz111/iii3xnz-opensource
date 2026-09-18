import { decrypt, encrypt } from "./crypto.js";
import { getConfiguredProvider } from "./oauth.js";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";

let database;
async function getDatabase() {
  database ||= (await import("./db/index.js")).default;
  return database;
}

function expiryFromToken(data) {
  return data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;
}

export async function createOAuthConnection({ userId, workspaceId, provider, identity, tokenData, scopes }) {
  const db = await getDatabase();
  const encryptedTokens = encrypt(JSON.stringify(tokenData));
  const id = uuid();
  await db.prepare(
    `INSERT INTO oauth_connections
      (id, user_id, workspace_id, provider, provider_account_id, account_label, scopes, encrypted_tokens, access_token_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, workspace_id, provider, provider_account_id)
     DO UPDATE SET account_label = EXCLUDED.account_label, scopes = EXCLUDED.scopes,
       encrypted_tokens = EXCLUDED.encrypted_tokens, access_token_expires_at = EXCLUDED.access_token_expires_at,
       status = 'connected', updated_at = NOW()`
  ).run(id, userId, workspaceId, provider, identity.id, identity.label, JSON.stringify(scopes || []), encryptedTokens, expiryFromToken(tokenData));
  return await db.prepare(
    "SELECT id, provider, provider_account_id, account_label, scopes, access_token_expires_at, status FROM oauth_connections WHERE user_id = ? AND workspace_id = ? AND provider = ? AND provider_account_id = ?"
  ).get(userId, workspaceId, provider, identity.id);
}

export async function listOAuthConnections(userId, workspaceId) {
  const db = await getDatabase();
  return db.prepare(
    "SELECT id, provider, provider_account_id, account_label, scopes, access_token_expires_at, status, created_at, updated_at FROM oauth_connections WHERE user_id = ? AND workspace_id = ? ORDER BY created_at DESC"
  ).all(userId, workspaceId);
}

export async function disconnectOAuthConnection(userId, workspaceId, id) {
  const db = await getDatabase();
  await db.prepare("DELETE FROM oauth_connections WHERE id = ? AND user_id = ? AND workspace_id = ?").run(id, userId, workspaceId);
}

export async function resolveOAuthCredential(userId, credentialId, workspaceId = null) {
  const db = await getDatabase();
  const row = workspaceId
    ? await db.prepare("SELECT * FROM oauth_connections WHERE id = ? AND user_id = ? AND workspace_id = ?").get(credentialId, userId, workspaceId)
    : await db.prepare("SELECT * FROM oauth_connections WHERE id = ? AND user_id = ?").get(credentialId, userId);
  if (!row) throw new Error("OAuth connection not found");
  let tokens = JSON.parse(decrypt(row.encrypted_tokens));
  const expiresAt = row.access_token_expires_at ? Date.parse(row.access_token_expires_at) : 0;
  if (expiresAt && expiresAt < Date.now() + 60_000) {
    if (!tokens.refresh_token) {
      await db.prepare("UPDATE oauth_connections SET status = 'expired', updated_at = NOW() WHERE id = ?").run(row.id);
      throw new Error("OAuth connection expired; reconnect it");
    }
    const refreshed = await refreshOAuthTokens(row.provider, tokens);
    if (!refreshed) {
      await db.prepare("UPDATE oauth_connections SET status = 'expired', updated_at = NOW() WHERE id = ?").run(row.id);
      throw new Error("OAuth token refresh failed; reconnect it");
    }
    tokens = { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token };
    await db.prepare("UPDATE oauth_connections SET encrypted_tokens = ?, access_token_expires_at = ?, status = 'connected', updated_at = NOW() WHERE id = ? AND user_id = ?").run(
      encrypt(JSON.stringify(tokens)), expiryFromToken(refreshed), row.id, userId
    );
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    token: tokens.access_token,
    apiKey: tokens.access_token,
    provider: row.provider,
    oauthConnectionId: row.id,
  };
}

export async function refreshOAuthTokens(providerName, tokens, request = fetch) {
  const provider = getConfiguredProvider(providerName);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    refresh_token: tokens.refresh_token,
  });
  const response = await request(provider.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    timeout: 15000,
  });
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || refreshed.error || !refreshed.access_token) return null;
  return refreshed;
}

