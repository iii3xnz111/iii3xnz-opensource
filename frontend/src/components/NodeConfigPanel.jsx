import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import CredentialSelector from "./CredentialSelector.jsx";

export default function NodeConfigPanel({ node, onChange, onClose, fullScreen }) {
  const [otherWorkflows, setOtherWorkflows] = useState([]);

  useEffect(() => {
    if (node?.type === "executeWorkflow") {
      api.listWorkflows().then(setOtherWorkflows).catch(() => {});
    }
  }, [node?.type]);

  if (!node) return null;
  const config = node.data?.config || {};

  function set(key, value) {
    onChange(node.id, { ...config, [key]: value });
  }

  return (
    <div style={fullScreen
      ? { width: "100%", padding: 16, boxSizing: "border-box" }
      : { width: 320, borderLeft: "1px solid var(--border)", padding: 16, overflowY: "auto" }
    }>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h4>{node.type}</h4>
        <button onClick={onClose}>×</button>
      </div>

      {node.type === "httpRequest" && (
        <>
          <label>Method</label>
          <select value={config.method || "GET"} onChange={(e) => set("method", e.target.value)}>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <label>URL</label>
          <input value={config.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://api.example.com/{{input.id}}" />
          <label>Body (JSON, supports {"{{input.x}}"})</label>
          <textarea rows={4} value={config.body || ""} onChange={(e) => set("body", e.target.value)} />
        </>
      )}

      {node.type === "ifCondition" && (
        <>
          <label>Left value</label>
          <input value={config.left || ""} onChange={(e) => set("left", e.target.value)} placeholder="{{input.status}}" />
          <label>Operator</label>
          <select value={config.operator || "equals"} onChange={(e) => set("operator", e.target.value)}>
            {["equals", "notEquals", "contains", "greaterThan", "lessThan"].map((o) => <option key={o}>{o}</option>)}
          </select>
          <label>Right value</label>
          <input value={config.right || ""} onChange={(e) => set("right", e.target.value)} placeholder="200" />
        </>
      )}

      {node.type === "setVariable" && (
        <>
          <label>Variable name</label>
          <input value={config.name || ""} onChange={(e) => set("name", e.target.value)} />
          <label>Value</label>
          <input value={config.value || ""} onChange={(e) => set("value", e.target.value)} placeholder="{{input.result}}" />
        </>
      )}

      {node.type === "delay" && (
        <>
          <label>Delay (ms, max 30000)</label>
          <input type="number" value={config.ms || 1000} onChange={(e) => set("ms", e.target.value)} />
        </>
      )}

      {node.type === "code" && (
        <>
          <label>JS body — return a value. Has `input` and `vars`.</label>
          <textarea rows={8} value={config.code || "return input;"} onChange={(e) => set("code", e.target.value)} />
        </>
      )}

      {node.type === "slackMessage" && (
        <>
          <CredentialSelector credentialType="slackWebhook" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Slack Incoming Webhook URL</label>
          <input value={config.webhookUrl || ""} onChange={(e) => set("webhookUrl", e.target.value)} placeholder="https://hooks.slack.com/services/..." />
          <label>Message text</label>
          <textarea rows={3} value={config.text || ""} onChange={(e) => set("text", e.target.value)} placeholder="Order {{input.orderId}} shipped!" />
          <small>Create a webhook at api.slack.com/apps → Incoming Webhooks — no OAuth setup needed.</small>
        </>
      )}

      {node.type === "discordMessage" && (
        <>
          <CredentialSelector credentialType="discordWebhook" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Discord Webhook URL</label>
          <input value={config.webhookUrl || ""} onChange={(e) => set("webhookUrl", e.target.value)} placeholder="https://discord.com/api/webhooks/..." />
          <label>Message content</label>
          <textarea rows={3} value={config.content || ""} onChange={(e) => set("content", e.target.value)} />
          <small>Create one in a channel's Settings → Integrations → Webhooks.</small>
        </>
      )}

      {node.type === "emailSend" && (
        <>
          <CredentialSelector credentialType="smtpAccount" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>SMTP host</label>
          <input value={config.smtpHost || ""} onChange={(e) => set("smtpHost", e.target.value)} placeholder="smtp.gmail.com" />
          <label>SMTP port</label>
          <input type="number" value={config.smtpPort || 587} onChange={(e) => set("smtpPort", e.target.value)} />
          <label>SMTP username</label>
          <input value={config.smtpUser || ""} onChange={(e) => set("smtpUser", e.target.value)} />
          <label>SMTP password</label>
          <input type="password" value={config.smtpPass || ""} onChange={(e) => set("smtpPass", e.target.value)} />
          <label>From</label>
          <input value={config.from || ""} onChange={(e) => set("from", e.target.value)} placeholder="you@yourapp.com" />
          <label>To</label>
          <input value={config.to || ""} onChange={(e) => set("to", e.target.value)} placeholder="{{input.email}}" />
          <label>Subject</label>
          <input value={config.subject || ""} onChange={(e) => set("subject", e.target.value)} />
          <label>Body</label>
          <textarea rows={4} value={config.text || ""} onChange={(e) => set("text", e.target.value)} />
        </>
      )}

      {node.type === "airtableCreateRecord" && (
        <>
          <CredentialSelector credentialType="airtableToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Personal Access Token</label>
          <input type="password" value={config.apiKey || ""} onChange={(e) => set("apiKey", e.target.value)} />
          <label>Base ID</label>
          <input value={config.baseId || ""} onChange={(e) => set("baseId", e.target.value)} placeholder="appXXXXXXXXXXXXXX" />
          <label>Table name</label>
          <input value={config.tableName || ""} onChange={(e) => set("tableName", e.target.value)} />
          <label>Fields (JSON)</label>
          <textarea rows={4} value={config.fieldsJson || ""} onChange={(e) => set("fieldsJson", e.target.value)} placeholder={'{"Name": "{{input.name}}"}'} />
        </>
      )}

      {node.type === "googleSheetsAppendRow" && (
        <>
          <CredentialSelector credentialType="googleServiceAccount" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Service account JSON (paste full key file)</label>
          <textarea rows={5} value={config.serviceAccountJson || ""} onChange={(e) => set("serviceAccountJson", e.target.value)} placeholder='{"client_email": "...", "private_key": "..."}' />
          <label>Spreadsheet ID</label>
          <input value={config.spreadsheetId || ""} onChange={(e) => set("spreadsheetId", e.target.value)} />
          <label>Sheet name</label>
          <input value={config.sheetName || "Sheet1"} onChange={(e) => set("sheetName", e.target.value)} />
          <label>Row values (JSON array)</label>
          <textarea rows={3} value={config.valuesJson || ""} onChange={(e) => set("valuesJson", e.target.value)} placeholder='["{{input.name}}", "{{input.email}}"]' />
          <small>Share the sheet with the service account's client_email as an Editor first.</small>
        </>
      )}

      {node.type === "gmailSendEmail" && (
        <>
          <CredentialSelector credentialType="googleServiceAccount" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Service account JSON</label>
          <textarea rows={4} value={config.serviceAccountJson || ""} onChange={(e) => set("serviceAccountJson", e.target.value)} />
          <label>Sender email</label>
          <input value={config.senderEmail || ""} onChange={(e) => set("senderEmail", e.target.value)} placeholder="sender@example.com" />
          <label>To</label>
          <input value={config.to || ""} onChange={(e) => set("to", e.target.value)} placeholder="{{input.email}}" />
          <label>Subject</label>
          <input value={config.subject || ""} onChange={(e) => set("subject", e.target.value)} />
          <label>Body</label>
          <textarea rows={4} value={config.text || ""} onChange={(e) => set("text", e.target.value)} />
        </>
      )}

      {node.type === "googleDriveCreateFile" && (
        <>
          <CredentialSelector credentialType="googleServiceAccount" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Service account JSON</label>
          <textarea rows={4} value={config.serviceAccountJson || ""} onChange={(e) => set("serviceAccountJson", e.target.value)} />
          <label>File name</label>
          <input value={config.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="report.txt" />
          <label>MIME type</label>
          <input value={config.mimeType || "text/plain"} onChange={(e) => set("mimeType", e.target.value)} />
          <label>Folder ID (optional)</label>
          <input value={config.folderId || ""} onChange={(e) => set("folderId", e.target.value)} />
          <label>File content</label>
          <textarea rows={4} value={config.content || ""} onChange={(e) => set("content", e.target.value)} placeholder="{{input.body}}" />
        </>
      )}

      {node.type === "microsoftTeamsMessage" && (
        <>
          <CredentialSelector credentialType="microsoftTeamsWebhook" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Teams webhook URL</label>
          <input value={config.webhookUrl || ""} onChange={(e) => set("webhookUrl", e.target.value)} placeholder="https://...webhook.office.com/..." />
          <label>Message text</label>
          <textarea rows={3} value={config.text || ""} onChange={(e) => set("text", e.target.value)} />
        </>
      )}

      {node.type === "telegramMessage" && (
        <>
          <CredentialSelector credentialType="telegramBot" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Bot token</label>
          <input type="password" value={config.botToken || ""} onChange={(e) => set("botToken", e.target.value)} placeholder="123456:ABC-DEF..." />
          <label>Chat ID</label>
          <input value={config.chatId || ""} onChange={(e) => set("chatId", e.target.value)} placeholder="{{input.chatId}}" />
          <label>Message text</label>
          <textarea rows={3} value={config.text || ""} onChange={(e) => set("text", e.target.value)} />
          <small>Create a bot via @BotFather on Telegram to get a token.</small>
        </>
      )}

      {node.type === "twilioSms" && (
        <>
          <CredentialSelector credentialType="twilioAuth" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Account SID</label>
          <input value={config.accountSid || ""} onChange={(e) => set("accountSid", e.target.value)} placeholder="ACxxxxxxxx" />
          <label>Auth token</label>
          <input type="password" value={config.authToken || ""} onChange={(e) => set("authToken", e.target.value)} />
          <label>From (Twilio number)</label>
          <input value={config.from || ""} onChange={(e) => set("from", e.target.value)} placeholder="+15551234567" />
          <label>To</label>
          <input value={config.to || ""} onChange={(e) => set("to", e.target.value)} placeholder="{{input.phone}}" />
          <label>Message body</label>
          <textarea rows={3} value={config.body || ""} onChange={(e) => set("body", e.target.value)} />
        </>
      )}

      {node.type === "notionCreatePage" && (
        <>
          <CredentialSelector credentialType="notionSecret" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Integration secret</label>
          <input type="password" value={config.apiKey || ""} onChange={(e) => set("apiKey", e.target.value)} placeholder="secret_..." />
          <label>Database ID</label>
          <input value={config.databaseId || ""} onChange={(e) => set("databaseId", e.target.value)} />
          <label>Properties (JSON, matching your database schema)</label>
          <textarea rows={4} value={config.propertiesJson || ""} onChange={(e) => set("propertiesJson", e.target.value)} placeholder='{"Name": {"title": [{"text": {"content": "{{input.name}}"}}]}}' />
          <small>Create an integration at notion.so/my-integrations, then share the database with it.</small>
        </>
      )}

      {node.type === "trelloCreateCard" && (
        <>
          <CredentialSelector credentialType="trelloAuth" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>API key</label>
          <input type="password" value={config.apiKey || ""} onChange={(e) => set("apiKey", e.target.value)} />
          <label>Token</label>
          <input type="password" value={config.token || ""} onChange={(e) => set("token", e.target.value)} />
          <label>List ID</label>
          <input value={config.listId || ""} onChange={(e) => set("listId", e.target.value)} />
          <label>Card name</label>
          <input value={config.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="{{input.title}}" />
          <label>Description</label>
          <textarea rows={3} value={config.desc || ""} onChange={(e) => set("desc", e.target.value)} />
        </>
      )}

      {node.type === "githubCreateIssue" && (
        <>
          <CredentialSelector credentialType="githubToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Personal access token</label>
          <input type="password" value={config.token || ""} onChange={(e) => set("token", e.target.value)} placeholder="ghp_..." />
          <label>Owner</label>
          <input value={config.owner || ""} onChange={(e) => set("owner", e.target.value)} placeholder="your-org-or-username" />
          <label>Repository</label>
          <input value={config.repo || ""} onChange={(e) => set("repo", e.target.value)} />
          <label>Issue title</label>
          <input value={config.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="{{input.title}}" />
          <label>Issue body</label>
          <textarea rows={3} value={config.body || ""} onChange={(e) => set("body", e.target.value)} />
        </>
      )}

      {node.type === "gitlabCreateIssue" && (
        <>
          <CredentialSelector credentialType="gitlabToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Personal access token</label>
          <input type="password" value={config.token || ""} onChange={(e) => set("token", e.target.value)} />
          <label>Project ID</label>
          <input value={config.projectId || ""} onChange={(e) => set("projectId", e.target.value)} placeholder="group/project or numeric ID" />
          <label>Issue title</label>
          <input value={config.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="{{input.title}}" />
          <label>Description</label>
          <textarea rows={3} value={config.description || ""} onChange={(e) => set("description", e.target.value)} />
        </>
      )}

      {node.type === "hubspotCreateContact" && (
        <>
          <CredentialSelector credentialType="hubspotToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Private app access token</label>
          <input type="password" value={config.apiKey || ""} onChange={(e) => set("apiKey", e.target.value)} placeholder="pat-..." />
          <label>Properties (JSON)</label>
          <textarea rows={4} value={config.propertiesJson || ""} onChange={(e) => set("propertiesJson", e.target.value)} placeholder='{"email": "{{input.email}}", "firstname": "{{input.name}}"}' />
        </>
      )}

      {node.type === "mailchimpAddSubscriber" && (
        <>
          <CredentialSelector credentialType="mailchimpToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>API key</label>
          <input type="password" value={config.apiKey || ""} onChange={(e) => set("apiKey", e.target.value)} placeholder="xxxx-us21" />
          <label>Audience (list) ID</label>
          <input value={config.listId || ""} onChange={(e) => set("listId", e.target.value)} />
          <label>Email</label>
          <input value={config.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="{{input.email}}" />
        </>
      )}

      {node.type === "googleCalendarCreateEvent" && (
        <>
          <CredentialSelector credentialType="googleServiceAccount" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Service account JSON</label>
          <textarea rows={4} value={config.serviceAccountJson || ""} onChange={(e) => set("serviceAccountJson", e.target.value)} placeholder='{"client_email": "...", "private_key": "..."}' />
          <label>Calendar ID</label>
          <input value={config.calendarId || "primary"} onChange={(e) => set("calendarId", e.target.value)} />
          <label>Event title</label>
          <input value={config.summary || ""} onChange={(e) => set("summary", e.target.value)} />
          <label>Start time (ISO 8601)</label>
          <input value={config.startTime || ""} onChange={(e) => set("startTime", e.target.value)} placeholder="2026-01-01T10:00:00Z" />
          <label>End time (ISO 8601)</label>
          <input value={config.endTime || ""} onChange={(e) => set("endTime", e.target.value)} placeholder="2026-01-01T11:00:00Z" />
          <small>Share the calendar with the service account's client_email first.</small>
        </>
      )}

      {node.type === "asanaCreateTask" && (
        <>
          <CredentialSelector credentialType="asanaToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Personal access token</label>
          <input type="password" value={config.token || ""} onChange={(e) => set("token", e.target.value)} />
          <label>Project ID</label>
          <input value={config.projectId || ""} onChange={(e) => set("projectId", e.target.value)} />
          <label>Task name</label>
          <input value={config.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="{{input.title}}" />
          <label>Notes</label>
          <textarea rows={3} value={config.notes || ""} onChange={(e) => set("notes", e.target.value)} />
        </>
      )}

      {node.type === "jiraCreateIssue" && (
        <>
          <CredentialSelector credentialType="jiraAuth" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Account email</label>
          <input value={config.email || ""} onChange={(e) => set("email", e.target.value)} />
          <label>API token</label>
          <input type="password" value={config.apiToken || ""} onChange={(e) => set("apiToken", e.target.value)} />
          <label>Site domain</label>
          <input value={config.domain || ""} onChange={(e) => set("domain", e.target.value)} placeholder="yourcompany.atlassian.net" />
          <label>Project key</label>
          <input value={config.projectKey || ""} onChange={(e) => set("projectKey", e.target.value)} placeholder="PROJ" />
          <label>Summary</label>
          <input value={config.summary || ""} onChange={(e) => set("summary", e.target.value)} placeholder="{{input.title}}" />
          <label>Issue type</label>
          <input value={config.issueType || "Task"} onChange={(e) => set("issueType", e.target.value)} />
        </>
      )}

      {node.type === "clickUpCreateTask" && (
        <>
          <CredentialSelector credentialType="clickupToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>API token</label>
          <input type="password" value={config.apiToken || ""} onChange={(e) => set("apiToken", e.target.value)} />
          <label>List ID</label>
          <input value={config.listId || ""} onChange={(e) => set("listId", e.target.value)} />
          <label>Task name</label>
          <input value={config.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="{{input.title}}" />
          <label>Description</label>
          <textarea rows={3} value={config.description || ""} onChange={(e) => set("description", e.target.value)} />
        </>
      )}

      {node.type === "linearCreateIssue" && (
        <>
          <CredentialSelector credentialType="linearApiKey" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>API key</label>
          <input type="password" value={config.apiKey || ""} onChange={(e) => set("apiKey", e.target.value)} />
          <label>Team ID</label>
          <input value={config.teamId || ""} onChange={(e) => set("teamId", e.target.value)} />
          <label>Issue title</label>
          <input value={config.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="{{input.title}}" />
          <label>Description</label>
          <textarea rows={3} value={config.description || ""} onChange={(e) => set("description", e.target.value)} />
        </>
      )}

      {node.type === "openaiGenerateText" && (
        <>
          <CredentialSelector credentialType="openaiToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>API key</label>
          <input type="password" value={config.apiKey || ""} onChange={(e) => set("apiKey", e.target.value)} placeholder="sk-..." />
          <label>Model</label>
          <input value={config.model || "gpt-4o-mini"} onChange={(e) => set("model", e.target.value)} />
          <label>Prompt</label>
          <textarea rows={4} value={config.prompt || ""} onChange={(e) => set("prompt", e.target.value)} placeholder="Summarize: {{input.text}}" />
        </>
      )}

      {node.type === "postgresQuery" && (
        <>
          <CredentialSelector credentialType="postgresConnection" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Connection string</label>
          <input type="password" value={config.connectionString || ""} onChange={(e) => set("connectionString", e.target.value)} placeholder="postgres://user:pass@host:5432/db" />
          <label>Query (use $1, $2... for params)</label>
          <textarea rows={3} value={config.query || ""} onChange={(e) => set("query", e.target.value)} placeholder="SELECT * FROM users WHERE id = $1" />
          <label>Params (JSON array)</label>
          <input value={config.paramsJson || ""} onChange={(e) => set("paramsJson", e.target.value)} placeholder='["{{input.id}}"]' />
          <small>Params are inserted safely — never build the query string by concatenating input.</small>
        </>
      )}

      {node.type === "shopifyCreateCustomer" && (
        <>
          <CredentialSelector credentialType="shopifyAccessToken" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Shop domain</label>
          <input value={config.shopDomain || ""} onChange={(e) => set("shopDomain", e.target.value)} placeholder="store.myshopify.com" />
          <label>Admin access token</label>
          <input type="password" value={config.accessToken || ""} onChange={(e) => set("accessToken", e.target.value)} />
          <label>Email</label>
          <input value={config.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="{{input.email}}" />
          <label>First name</label>
          <input value={config.firstName || ""} onChange={(e) => set("firstName", e.target.value)} />
          <label>Last name</label>
          <input value={config.lastName || ""} onChange={(e) => set("lastName", e.target.value)} />
        </>
      )}

      {node.type === "stripeCreateCustomer" && (
        <>
          <CredentialSelector credentialType="stripeApiKey" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Secret API key</label>
          <input type="password" value={config.apiKey || ""} onChange={(e) => set("apiKey", e.target.value)} placeholder="sk_..." />
          <label>Email</label>
          <input value={config.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="{{input.email}}" />
          <label>Name</label>
          <input value={config.name || ""} onChange={(e) => set("name", e.target.value)} />
          <label>Description</label>
          <input value={config.description || ""} onChange={(e) => set("description", e.target.value)} />
        </>
      )}

      {node.type === "twilioWhatsapp" && (
        <>
          <CredentialSelector credentialType="twilioAuth" value={config.credentialId} onChange={(v) => set("credentialId", v)} />
          <label>Account SID</label>
          <input value={config.accountSid || ""} onChange={(e) => set("accountSid", e.target.value)} />
          <label>Auth token</label>
          <input type="password" value={config.authToken || ""} onChange={(e) => set("authToken", e.target.value)} />
          <label>From (Twilio WhatsApp number)</label>
          <input value={config.from || ""} onChange={(e) => set("from", e.target.value)} placeholder="+14155238886" />
          <label>To</label>
          <input value={config.to || ""} onChange={(e) => set("to", e.target.value)} placeholder="{{input.phone}}" />
          <label>Message body</label>
          <textarea rows={3} value={config.body || ""} onChange={(e) => set("body", e.target.value)} />
        </>
      )}

      {node.type === "filter" && (
        <>
          <label>Left value</label>
          <input value={config.left || ""} onChange={(e) => set("left", e.target.value)} placeholder="{{input.status}}" />
          <label>Operator</label>
          <select value={config.operator || "equals"} onChange={(e) => set("operator", e.target.value)}>
            {["equals", "notEquals", "contains", "greaterThan", "lessThan"].map((o) => <option key={o}>{o}</option>)}
          </select>
          <label>Right value</label>
          <input value={config.right || ""} onChange={(e) => set("right", e.target.value)} placeholder="200" />
          <small>If false, this branch stops here — the run still succeeds.</small>
        </>
      )}

      {node.type === "loop" && (
        <>
          <label>Array to loop over</label>
          <input value={config.arrayPath || "input"} onChange={(e) => set("arrayPath", e.target.value)} placeholder="input.items" />
          <label>JS run per item — has `item`, `input`, `vars`</label>
          <textarea rows={5} value={config.code || "return item;"} onChange={(e) => set("code", e.target.value)} />
          <small>Returns an array of each iteration's result.</small>
        </>
      )}

      {node.type === "merge" && (
        <>
          <label>Merge mode</label>
          <select value={config.mode || "waitForAll"} onChange={(e) => set("mode", e.target.value)}>
            <option value="waitForAll">Wait for all incoming branches</option>
          </select>
          <small>This node persists each incoming branch result and continues only once every connected branch completes. A failed branch fails the run; a stale worker claim can be safely reclaimed.</small>
        </>
      )}

      {node.type === "executeWorkflow" && (
        <>
          <label>Workflow to run</label>
          <select value={config.workflowId || ""} onChange={(e) => set("workflowId", e.target.value)}>
            <option value="">Select a workflow...</option>
            {otherWorkflows.filter((w) => w.id !== node.parentWorkflowId).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <small>Runs that workflow with this node's input as its trigger payload.</small>
        </>
      )}

      {node.type === "scheduleTrigger" && (
        <>
          <label>Cron expression</label>
          <input value={config.cron || "*/5 * * * *"} onChange={(e) => set("cron", e.target.value)} />
          <small>e.g. */5 * * * * = every 5 minutes</small>
        </>
      )}

      {node.type === "webhookTrigger" && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No config needed — save the workflow and activate it to get a live webhook URL.
        </p>
      )}

      {node.type === "manualTrigger" && (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Runs only when you click "Run now".</p>
      )}

      <style>{`label { display:block; margin-top:12px; font-size:12px; font-weight:600; }
        input, select, textarea { width:100%; margin-top:4px; padding:6px; box-sizing:border-box; }`}</style>
    </div>
  );
}
