import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { requireAuth } from "../auth.js";
import { encrypt, decrypt } from "../crypto.js";
import { getWorkspaceId } from "../workspace.js";
import {
  buildAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  frontendOAuthResultUrl,
  getConfiguredProvider,
  hashOAuthState,
  exchangeOAuthCode,
  fetchOAuthIdentity,
  listOAuthProviders,
} from "../oauth.js";
import { createOAuthConnection, disconnectOAuthConnection, listOAuthConnections } from "../oauthConnections.js";
import { callbackProviderFromState } from "../oauthCallbackPolicy.js";

const router = Router();
const STATE_TTL_MINUTES = 10;

router.get("/providers", requireAuth, (req, res) => {
  res.json(listOAuthProviders());
});

router.get("/connections", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  res.json(await listOAuthConnections(req.user.id, workspaceId));
});

router.post("/start", requireAuth, async (req, res) => {
  const { provider } = req.body || {};
  const configured = getConfiguredProvider(provider);
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  const state = createOAuthState();
  const { verifier, challenge } = createPkcePair();
  await db.prepare(
    `INSERT INTO oauth_states (id, state_hash, provider, user_id, workspace_id, code_verifier_encrypted, redirect_uri, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + (? * INTERVAL '1 minute'))`
  ).run(uuid(), hashOAuthState(state), provider, req.user.id, workspaceId, encrypt(verifier), configured.redirectUri, STATE_TTL_MINUTES);
  res.json({ authorizationUrl: buildAuthorizationUrl(provider, state, challenge), provider: configured.label });
});

router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (typeof state !== "string") {
    return res.redirect(frontendOAuthResultUrl("failed", "unknown"));
  }

  let pending;
  let provider = "unknown";
  try {
    pending = await db.transaction(async (tx) => {
      const result = await tx.query(
        "SELECT * FROM oauth_states WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > NOW() FOR UPDATE",
        [hashOAuthState(state)]
      );
      const row = result.rows[0];
      if (!row) throw new Error("Invalid or expired OAuth state");
      await tx.query("UPDATE oauth_states SET consumed_at = NOW() WHERE id = ?", [row.id]);
      return row;
    });
    provider = callbackProviderFromState(pending);
    if (error || typeof code !== "string") throw new Error("OAuth authorization was not completed");
    const verifier = decrypt(pending.code_verifier_encrypted);
    const tokenData = await exchangeOAuthCode(provider, code, verifier);
    const identity = await fetchOAuthIdentity(provider, tokenData.access_token);
    await createOAuthConnection({
      userId: pending.user_id,
      workspaceId: pending.workspace_id,
      provider,
      identity,
      tokenData,
      scopes: tokenData.scope ? tokenData.scope.split(" ") : getConfiguredProvider(provider).scopes,
    });
    res.redirect(frontendOAuthResultUrl("success", provider));
  } catch {
    res.redirect(frontendOAuthResultUrl("failed", provider));
  }
});

router.delete("/connections/:id", requireAuth, async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id, req.headers["x-workspace-id"]);
  await disconnectOAuthConnection(req.user.id, workspaceId, req.params.id);
  res.json({ ok: true });
});

router.post("/cleanup", requireAuth, async (req, res) => {
  await db.prepare("DELETE FROM oauth_states WHERE expires_at < NOW() OR consumed_at < NOW() - INTERVAL '1 day'").run();
  res.json({ ok: true });
});

export default router;
