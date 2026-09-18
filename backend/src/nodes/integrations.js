import fetch from "node-fetch";
import nodemailer from "nodemailer";
import { google } from "googleapis";

// Shared template resolver — duplicated import avoided by taking it as a param
// from index.js so there's a single source of truth for {{input.x}} syntax.

export async function requestWithTimeout(request, url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function makeIntegrationHandlers(resolveTemplate, request = fetch) {
  async function resolveGoogleConfig(config, ctx) {
    return config.credentialId ? { ...config, ...(await ctx.getCredential(config.credentialId)) } : config;
  }

  function googleAuth(config, scopes) {
    if (config.accessToken) {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: config.accessToken });
      return auth;
    }
    let credentials;
    try { credentials = JSON.parse(config.serviceAccountJson); }
    catch { throw new Error("Google service account JSON is not valid JSON"); }
    return new google.auth.GoogleAuth({ credentials, scopes });
  }

  async function requestJson(url, options, label, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const timeoutMs = options.timeout || 15000;
      const res = await requestWithTimeout(request, url, options, timeoutMs);
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (res.ok) return data;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === retries) throw new Error(`${label} request failed (${res.status})`);
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter * 1000, 250 * (attempt + 1)), 4000)));
    }
    throw new Error(`${label} request failed`);
  }

  return {
    // Slack: uses an Incoming Webhook URL (created in Slack's app settings —
    // no OAuth flow needed). Restricted to Slack's own domain so this can't
    // be repurposed as a generic "call any URL" node under a friendlier name.
    slackMessage: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const webhookUrl = resolveTemplate(config.webhookUrl, input, ctx.vars);
      let host;
      try {
        host = new URL(webhookUrl).hostname;
      } catch {
        throw new Error("Invalid Slack webhook URL");
      }
      if (host !== "hooks.slack.com") {
        throw new Error("Slack node only accepts hooks.slack.com webhook URLs");
      }
      const text = resolveTemplate(config.text || "", input, ctx.vars);
      const res = await requestWithTimeout(request, webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        timeout: 10000,
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`Slack webhook failed (${res.status}): ${body}`);
      return { ok: true, status: res.status };
    },

    // Discord: same pattern as Slack — Incoming Webhook URL, domain-restricted.
    discordMessage: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const webhookUrl = resolveTemplate(config.webhookUrl, input, ctx.vars);
      let host;
      try {
        host = new URL(webhookUrl).hostname;
      } catch {
        throw new Error("Invalid Discord webhook URL");
      }
      if (!["discord.com", "discordapp.com"].includes(host)) {
        throw new Error("Discord node only accepts discord.com webhook URLs");
      }
      const content = resolveTemplate(config.content || "", input, ctx.vars);
      const res = await requestWithTimeout(request, webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        timeout: 10000,
      });
      if (!res.ok) throw new Error(`Discord webhook failed (${res.status}): ${await res.text()}`);
      return { ok: true, status: res.status };
    },

    // Email via the user's own SMTP credentials (Gmail app password, SendGrid
    // SMTP, Mailgun, etc.) — no email-sending infra of your own needed.
    emailSend: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const host = resolveTemplate(config.smtpHost, input, ctx.vars);
      const port = Number(config.smtpPort) || 587;
      const user = resolveTemplate(config.smtpUser, input, ctx.vars);
      const pass = config.smtpPass; // not template-resolved: avoids leaking a secret into logs via accidental {{}} misuse
      if (!host || !user || !pass) throw new Error("SMTP host, user, and password are required");

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      const info = await transporter.sendMail({
        from: resolveTemplate(config.from || user, input, ctx.vars),
        to: resolveTemplate(config.to, input, ctx.vars),
        subject: resolveTemplate(config.subject || "", input, ctx.vars),
        text: resolveTemplate(config.text || "", input, ctx.vars),
      });
      return { messageId: info.messageId };
    },

    // Airtable: fixed API host (api.airtable.com), so no SSRF surface — only
    // the base/table path segments and the record fields are user-supplied.
    airtableCreateRecord: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const apiKey = config.apiKey; // not template-resolved — same reasoning as SMTP password
      const baseId = resolveTemplate(config.baseId, input, ctx.vars);
      const tableName = resolveTemplate(config.tableName, input, ctx.vars);
      if (!apiKey || !baseId || !tableName) throw new Error("Airtable API key, base ID, and table name are required");

      let fields;
      try {
        fields = JSON.parse(resolveTemplate(config.fieldsJson || "{}", input, ctx.vars));
      } catch {
        throw new Error("Fields must be valid JSON, e.g. {\"Name\": \"{{input.name}}\"}");
      }

      const res = await requestWithTimeout(request,
        `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
          timeout: 10000,
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(`Airtable error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // Google Sheets via a Service Account (no interactive OAuth flow needed):
    // the user creates a service account in Google Cloud, downloads its JSON
    // key, and shares the target sheet with the service account's email —
    // same access model Zapier/n8n use for their non-OAuth Sheets option.
    googleSheetsAppendRow: async (config, input, ctx) => {
      config = await resolveGoogleConfig(config, ctx);
      const spreadsheetId = resolveTemplate(config.spreadsheetId, input, ctx.vars);
      const sheetName = resolveTemplate(config.sheetName || "Sheet1", input, ctx.vars);
      let values;
      try {
        values = JSON.parse(resolveTemplate(config.valuesJson, input, ctx.vars));
      } catch {
        throw new Error('Values must be a JSON array, e.g. ["{{input.name}}", "{{input.email}}"]');
      }

      const auth = googleAuth(config, ["https://www.googleapis.com/auth/spreadsheets"]);
      const sheets = google.sheets({ version: "v4", auth });
      const result = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [values] },
      });
      return { updatedRange: result.data.updates?.updatedRange };
    },

    gmailSendEmail: async (config, input, ctx) => {
      config = await resolveGoogleConfig(config, ctx);
      const from = resolveTemplate(config.senderEmail || config.from, input, ctx.vars);
      const to = resolveTemplate(config.to, input, ctx.vars);
      const subject = resolveTemplate(config.subject || "", input, ctx.vars);
      const text = resolveTemplate(config.text || "", input, ctx.vars);
      if (!from || !to || !subject) throw new Error("Sender email, recipient, and subject are required");
      const auth = googleAuth(config, ["https://www.googleapis.com/auth/gmail.send"]);
      const gmail = google.gmail({ version: "v1", auth });
      const raw = Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`)
        .toString("base64url");
      const result = await gmail.users.messages.send({ userId: config.userId || from, requestBody: { raw } });
      return { messageId: result.data.id, threadId: result.data.threadId };
    },

    googleDriveCreateFile: async (config, input, ctx) => {
      config = await resolveGoogleConfig(config, ctx);
      const name = resolveTemplate(config.name, input, ctx.vars);
      const content = resolveTemplate(config.content || "", input, ctx.vars);
      if (!name) throw new Error("File name is required");
      const auth = googleAuth(config, ["https://www.googleapis.com/auth/drive.file"]);
      const drive = google.drive({ version: "v3", auth });
      const result = await drive.files.create({
        requestBody: { name, mimeType: config.mimeType || "text/plain", ...(config.folderId ? { parents: [resolveTemplate(config.folderId, input, ctx.vars)] } : {}) },
        media: { mimeType: config.mimeType || "text/plain", body: content },
        fields: "id,name,webViewLink,mimeType",
      });
      return result.data;
    },

    microsoftTeamsMessage: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const webhookUrl = resolveTemplate(config.webhookUrl, input, ctx.vars);
      let parsed;
      try { parsed = new URL(webhookUrl); } catch { throw new Error("Invalid Microsoft Teams webhook URL"); }
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== "https:") throw new Error("Teams webhook must use HTTPS");
      if (!host.endsWith(".webhook.office.com") && host !== "outlook.office.com") throw new Error("Teams node only accepts Microsoft webhook URLs");
      const text = resolveTemplate(config.text || "", input, ctx.vars);
      if (!text) throw new Error("Message text is required");
      await requestJson(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }, "Teams");
      return { ok: true };
    },

    clickUpCreateTask: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const token = config.apiToken;
      const listId = resolveTemplate(config.listId, input, ctx.vars);
      const name = resolveTemplate(config.name || "", input, ctx.vars);
      if (!token || !listId || !name) throw new Error("API token, list ID, and task name are required");
      return requestJson(`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`, {
        method: "POST", headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: resolveTemplate(config.description || "", input, ctx.vars) }),
      }, "ClickUp");
    },

    gitlabCreateIssue: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const token = config.token;
      const projectId = resolveTemplate(config.projectId, input, ctx.vars);
      const title = resolveTemplate(config.title || "", input, ctx.vars);
      if (!token || !projectId || !title) throw new Error("Token, project ID, and title are required");
      const params = new URLSearchParams({ title, description: resolveTemplate(config.description || "", input, ctx.vars) });
      return requestJson(`https://gitlab.com/api/v4/projects/${encodeURIComponent(projectId)}/issues`, {
        method: "POST", headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
      }, "GitLab");
    },

    linearCreateIssue: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const apiKey = config.apiKey;
      const teamId = resolveTemplate(config.teamId, input, ctx.vars);
      const title = resolveTemplate(config.title || "", input, ctx.vars);
      if (!apiKey || !teamId || !title) throw new Error("API key, team ID, and title are required");
      const data = await requestJson("https://api.linear.app/graphql", {
        method: "POST", headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }", variables: { input: { teamId, title, description: resolveTemplate(config.description || "", input, ctx.vars) } } }),
      }, "Linear");
      if (data.errors?.length || data.data?.issueCreate?.success === false) throw new Error("Linear request failed");
      return data.data?.issueCreate?.issue || data;
    },

    shopifyCreateCustomer: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const shopDomain = String(resolveTemplate(config.shopDomain, input, ctx.vars) || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
      const accessToken = config.accessToken;
      const email = resolveTemplate(config.email || "", input, ctx.vars);
      if (!shopDomain || !accessToken || !email) throw new Error("Shop domain, access token, and email are required");
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain)) throw new Error("Shop domain must be a valid myshopify.com domain");
      const data = await requestJson(`https://${shopDomain}/admin/api/2024-10/customers.json`, {
        method: "POST", headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ customer: { email, first_name: resolveTemplate(config.firstName || "", input, ctx.vars), last_name: resolveTemplate(config.lastName || "", input, ctx.vars) } }),
      }, "Shopify");
      return data.customer || data;
    },

    stripeCreateCustomer: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const apiKey = config.apiKey;
      const email = resolveTemplate(config.email || "", input, ctx.vars);
      if (!apiKey || !email) throw new Error("API key and email are required");
      const params = new URLSearchParams({ email, name: resolveTemplate(config.name || "", input, ctx.vars), description: resolveTemplate(config.description || "", input, ctx.vars) });
      return requestJson("https://api.stripe.com/v1/customers", {
        method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
      }, "Stripe");
    },

    // Telegram: fixed API host (api.telegram.org), bot token goes in the URL
    // path per Telegram's own API design — treated as a secret, not template-resolved.
    telegramMessage: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const botToken = config.botToken;
      const chatId = resolveTemplate(config.chatId, input, ctx.vars);
      const text = resolveTemplate(config.text || "", input, ctx.vars);
      if (!botToken || !chatId) throw new Error("Bot token and chat ID are required");

      const res = await requestWithTimeout(request, `https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        timeout: 10000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Telegram error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // Twilio SMS: fixed API host (api.twilio.com). Twilio's API takes
    // form-encoded params, not JSON, and auth is HTTP Basic (accountSid:authToken).
    twilioSms: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const accountSid = config.accountSid;
      const authToken = config.authToken; // secret — not template-resolved
      const from = resolveTemplate(config.from, input, ctx.vars);
      const to = resolveTemplate(config.to, input, ctx.vars);
      const body = resolveTemplate(config.body || "", input, ctx.vars);
      if (!accountSid || !authToken || !from || !to) {
        throw new Error("Account SID, auth token, from, and to are required");
      }

      const params = new URLSearchParams({ From: from, To: to, Body: body });
      const res = await requestWithTimeout(request,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
          timeout: 10000,
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(`Twilio error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // Notion: fixed API host, integration secret via Bearer token (created in
    // Notion's "My integrations" page — no OAuth flow for internal integrations).
    notionCreatePage: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const apiKey = config.apiKey; // secret
      const databaseId = resolveTemplate(config.databaseId, input, ctx.vars);
      if (!apiKey || !databaseId) throw new Error("API key and database ID are required");

      let properties;
      try {
        properties = JSON.parse(resolveTemplate(config.propertiesJson || "{}", input, ctx.vars));
      } catch {
        throw new Error('Properties must be valid JSON matching your database schema, e.g. {"Name": {"title": [{"text": {"content": "{{input.name}}"}}]}}');
      }

      const res = await requestWithTimeout(request, "https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
        timeout: 10000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Notion error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // Trello: fixed API host. Trello's API takes the key/token as query
    // params rather than a header — that's Trello's own design, not a choice here.
    trelloCreateCard: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const apiKey = config.apiKey; // secret
      const token = config.token; // secret
      const listId = resolveTemplate(config.listId, input, ctx.vars);
      const name = resolveTemplate(config.name || "", input, ctx.vars);
      const desc = resolveTemplate(config.desc || "", input, ctx.vars);
      if (!apiKey || !token || !listId) throw new Error("API key, token, and list ID are required");

      const url = new URL("https://api.trello.com/1/cards");
      url.searchParams.set("idList", listId);
      url.searchParams.set("name", name);
      url.searchParams.set("desc", desc);
      url.searchParams.set("key", apiKey);
      url.searchParams.set("token", token);

      const res = await requestWithTimeout(request, url.toString(), { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(`Trello error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // GitHub: fixed API host. Requires a User-Agent header — GitHub's API
    // rejects requests without one, regardless of auth validity.
    githubCreateIssue: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const token = config.token; // secret
      const owner = resolveTemplate(config.owner, input, ctx.vars);
      const repo = resolveTemplate(config.repo, input, ctx.vars);
      const title = resolveTemplate(config.title || "", input, ctx.vars);
      const body = resolveTemplate(config.body || "", input, ctx.vars);
      if (!token || !owner || !repo || !title) throw new Error("Token, owner, repo, and title are required");

      const res = await requestWithTimeout(request, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "iii3xnz",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({ title, body }),
        timeout: 10000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`GitHub error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // HubSpot: fixed API host, private app access token via Bearer auth.
    hubspotCreateContact: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const apiKey = config.apiKey; // secret
      let properties;
      try {
        properties = JSON.parse(resolveTemplate(config.propertiesJson || "{}", input, ctx.vars));
      } catch {
        throw new Error('Properties must be valid JSON, e.g. {"email": "{{input.email}}", "firstname": "{{input.name}}"}');
      }
      if (!apiKey) throw new Error("Private app access token is required");

      const res = await requestWithTimeout(request, "https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties }),
        timeout: 10000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`HubSpot error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // Mailchimp: the API key itself encodes which regional datacenter to hit
    // (the suffix after the dash, e.g. "abc123-us21") — Mailchimp's own
    // design, not something we chose.
    mailchimpAddSubscriber: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const apiKey = config.apiKey; // secret
      const listId = resolveTemplate(config.listId, input, ctx.vars);
      const email = resolveTemplate(config.email, input, ctx.vars);
      if (!apiKey || !listId || !email) throw new Error("API key, list ID, and email are required");

      const datacenter = apiKey.split("-")[1];
      if (!datacenter) throw new Error("API key doesn't look like a Mailchimp key (expected format: xxxx-us21)");

      const res = await requestWithTimeout(request, `https://${datacenter}.api.mailchimp.com/3.0/lists/${encodeURIComponent(listId)}/members`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email_address: email, status: config.status || "subscribed" }),
        timeout: 10000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Mailchimp error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // Google Calendar: same service-account approach as the Sheets node —
    // no interactive OAuth flow, just share the calendar with the service
    // account's email as an Editor.
    googleCalendarCreateEvent: async (config, input, ctx) => {
      config = await resolveGoogleConfig(config, ctx);
      const calendarId = resolveTemplate(config.calendarId || "primary", input, ctx.vars);
      const summary = resolveTemplate(config.summary || "", input, ctx.vars);
      const startTime = resolveTemplate(config.startTime, input, ctx.vars);
      const endTime = resolveTemplate(config.endTime, input, ctx.vars);
      if (!startTime || !endTime) throw new Error("Start time and end time are required (ISO 8601, e.g. 2026-01-01T10:00:00Z)");

      const auth = googleAuth(config, ["https://www.googleapis.com/auth/calendar"]);
      const calendar = google.calendar({ version: "v3", auth });
      const result = await calendar.events.insert({
        calendarId,
        requestBody: { summary, start: { dateTime: startTime }, end: { dateTime: endTime } },
      });
      return { eventId: result.data.id, htmlLink: result.data.htmlLink };
    },

    // Asana: personal access token via Bearer auth, fixed API host.
    asanaCreateTask: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const token = config.token; // secret
      const projectId = resolveTemplate(config.projectId, input, ctx.vars);
      const name = resolveTemplate(config.name || "", input, ctx.vars);
      const notes = resolveTemplate(config.notes || "", input, ctx.vars);
      if (!token || !projectId || !name) throw new Error("Token, project ID, and task name are required");

      const res = await requestWithTimeout(request, "https://app.asana.com/api/1.0/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ data: { name, notes, projects: [projectId] } }),
        timeout: 10000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Asana error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // Jira Cloud: Basic auth using an account email + API token (not a
    // password — Jira deprecated password-based Basic auth for the API).
    jiraCreateIssue: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const email = config.email;
      const apiToken = config.apiToken; // secret
      const domain = resolveTemplate(config.domain, input, ctx.vars); // e.g. yourcompany.atlassian.net
      const projectKey = resolveTemplate(config.projectKey, input, ctx.vars);
      const summary = resolveTemplate(config.summary || "", input, ctx.vars);
      if (!email || !apiToken || !domain || !projectKey || !summary) {
        throw new Error("Email, API token, domain, project key, and summary are all required");
      }

      const res = await requestWithTimeout(request, `https://${domain}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            summary,
            issuetype: { name: config.issueType || "Task" },
          },
        }),
        timeout: 10000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Jira error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },

    // OpenAI: fixed API host. Model defaults to a small/cheap one but is
    // user-overridable, since the "best" model name changes over time and
    // hardcoding one risks going stale.
    openaiGenerateText: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const apiKey = config.apiKey; // secret
      const prompt = resolveTemplate(config.prompt || "", input, ctx.vars);
      if (!apiKey || !prompt) throw new Error("API key and prompt are required");

      const res = await requestWithTimeout(request, "https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model || "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
        }),
        timeout: 30000,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`OpenAI error (${res.status}): ${JSON.stringify(data)}`);
      return { text: data.choices?.[0]?.message?.content, raw: data };
    },

    // WhatsApp via Twilio: same Messages API as SMS, but From/To need a
    // "whatsapp:" prefix — that's Twilio's own convention for routing a
    // message through WhatsApp instead of plain SMS.
    twilioWhatsapp: async (config, input, ctx) => {
      if (config.credentialId) config = { ...config, ...(await ctx.getCredential(config.credentialId)) };
      const accountSid = config.accountSid;
      const authToken = config.authToken; // secret
      const from = resolveTemplate(config.from, input, ctx.vars);
      const to = resolveTemplate(config.to, input, ctx.vars);
      const body = resolveTemplate(config.body || "", input, ctx.vars);
      if (!accountSid || !authToken || !from || !to) {
        throw new Error("Account SID, auth token, from, and to are required");
      }

      const params = new URLSearchParams({
        From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
        To: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
        Body: body,
      });
      const res = await requestWithTimeout(request,
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
          timeout: 10000,
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(`Twilio error (${res.status}): ${JSON.stringify(data)}`);
      return data;
    },
  };
}
