import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { requireAuth } from "../auth.js";
import { encrypt, decrypt } from "../crypto.js";
import { resolveOAuthCredential } from "../oauthConnections.js";
import { getWorkspaceContext } from "../workspace.js";

const router = Router();

// What fields each credential type expects — drives both validation here and
// the "create credential" form on the frontend.
export const CREDENTIAL_TYPES = {
  slackWebhook: { label: "Slack Webhook", authMode: "Webhook URL", fields: ["webhookUrl"] },
  discordWebhook: { label: "Discord Webhook", authMode: "Webhook URL", fields: ["webhookUrl"] },
  smtpAccount: { label: "SMTP Email Account", authMode: "SMTP credentials", fields: ["smtpHost", "smtpPort", "smtpUser", "smtpPass", "from"] },
  airtableToken: { label: "Airtable Token", authMode: "API token", fields: ["apiKey"] },
  googleServiceAccount: { label: "Google Service Account", authMode: "Service account", fields: ["serviceAccountJson", "senderEmail"] },
  telegramBot: { label: "Telegram Bot", authMode: "Bot token", fields: ["botToken"] },
  twilioAuth: { label: "Twilio Account", authMode: "API credentials", fields: ["accountSid", "authToken"] },
  notionSecret: { label: "Notion Integration", authMode: "Integration token", fields: ["apiKey"] },
  trelloAuth: { label: "Trello Account", authMode: "API credentials", fields: ["apiKey", "token"] },
  githubToken: { label: "GitHub Token", authMode: "Personal access token", fields: ["token"] },
  gitlabToken: { label: "GitLab Token", authMode: "Personal access token", fields: ["token"] },
  hubspotToken: { label: "HubSpot Token", authMode: "Private app token", fields: ["apiKey"] },
  mailchimpToken: { label: "Mailchimp API Key", authMode: "API key", fields: ["apiKey"] },
  asanaToken: { label: "Asana Token", authMode: "Personal access token", fields: ["token"] },
  jiraAuth: { label: "Jira Account", authMode: "Email and API token", fields: ["email", "apiToken"] },
  linearApiKey: { label: "Linear API Key", authMode: "API key", fields: ["apiKey"] },
  microsoftTeamsWebhook: { label: "Microsoft Teams Webhook", authMode: "Webhook URL", fields: ["webhookUrl"] },
  clickupToken: { label: "ClickUp Token", authMode: "API token", fields: ["apiToken"] },
  openaiToken: { label: "OpenAI API Key", authMode: "API key", fields: ["apiKey"] },
  postgresConnection: { label: "Postgres Connection", authMode: "Database connection", fields: ["connectionString"] },
  shopifyAccessToken: { label: "Shopify Access Token", authMode: "Admin API token", fields: ["shopDomain", "accessToken"] },
  stripeApiKey: { label: "Stripe API Key", authMode: "Secret API key", fields: ["apiKey"] },
};

router.get("/types", requireAuth, (req, res) => {
  res.json(CREDENTIAL_TYPES);
});

router.get("/", requireAuth, async (req, res) => {
  const workspace = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  // Never returns encrypted_data — the list is for picking a credential by
  // name in the node config UI, not for reading secrets back out.
  const rows = await db
    .prepare("SELECT id, name, type, created_at FROM credentials WHERE workspace_id = ? AND user_id = ? ORDER BY created_at DESC")
    .all(workspace.id, req.user.id);
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const workspace = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  const { name, type, data } = req.body;
  const typeDef = CREDENTIAL_TYPES[type];
  if (!typeDef) return res.status(400).json({ error: "Unknown credential type" });
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Name is required" });
  if (typeof data !== "object" || data === null) return res.status(400).json({ error: "Data must be an object" });

  const missing = typeDef.fields.filter((f) => !data[f]);
  if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });

  let encrypted;
  try {
    encrypted = encrypt(JSON.stringify(data));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const id = uuid();
  await db.prepare(
    "INSERT INTO credentials (id, user_id, workspace_id, name, type, encrypted_data) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, req.user.id, workspace.id, name.trim(), type, encrypted);

  res.json({ id, name: name.trim(), type });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const workspace = await getWorkspaceContext(req.user.id, req.headers["x-workspace-id"]);
  await db.prepare("DELETE FROM credentials WHERE id = ? AND user_id = ? AND workspace_id = ?").run(req.params.id, req.user.id, workspace.id);
  res.json({ ok: true });
});

// Internal helper (not a route) used by the execution engine to decrypt a
// credential's fields at run time. Scoped to the owning user — a workflow
// can never resolve another user's credential, even by guessing an ID.
export async function resolveCredential(userId, credentialId, workspaceId = null) {
  const row = await db
    .prepare("SELECT * FROM credentials WHERE id = ? AND user_id = ? AND workspace_id = ?")
    .get(credentialId, userId, workspaceId);
  if (!row) return resolveOAuthCredential(userId, credentialId, workspaceId);
  return JSON.parse(decrypt(row.encrypted_data));
}

export default router;
