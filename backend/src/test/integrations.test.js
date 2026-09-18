import { test } from "node:test";
import assert from "node:assert/strict";
import { makeIntegrationHandlers, requestWithTimeout } from "../nodes/integrations.js";

const render = (value) => value;

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    json: async () => typeof body === "string" ? JSON.parse(body) : body,
  };
}

function context() {
  return { vars: {}, getCredential: async () => ({}) };
}

test("new integration handlers validate required configuration without making requests", async () => {
  const handlers = makeIntegrationHandlers(render, async () => {
    throw new Error("request should not be called");
  });
  const cases = [
    ["microsoftTeamsMessage", {}, /webhook URL/],
    ["clickUpCreateTask", {}, /API token/],
    ["gitlabCreateIssue", {}, /Token/],
    ["linearCreateIssue", {}, /API key/],
    ["shopifyCreateCustomer", {}, /Shop domain/],
    ["stripeCreateCustomer", {}, /API key/],
  ];
  for (const [type, config, expected] of cases) {
    await assert.rejects(() => handlers[type](config, {}, context()), expected);
  }
});

test("Teams handler restricts webhook destinations and maps message text", async () => {
  const calls = [];
  const handlers = makeIntegrationHandlers(render, async (url, options) => {
    calls.push({ url, options });
    return response(200, {});
  });
  await handlers.microsoftTeamsMessage({ webhookUrl: "https://tenant.webhook.office.com/webhookb2/x", text: "Hello" }, {}, context());
  assert.equal(calls[0].url, "https://tenant.webhook.office.com/webhookb2/x");
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: "Hello" });
  await assert.rejects(() => handlers.microsoftTeamsMessage({ webhookUrl: "https://example.com/hook", text: "Hello" }, {}, context()), /Microsoft webhook/);
});

test("ClickUp and GitLab handlers build authenticated mapped requests", async () => {
  const calls = [];
  const handlers = makeIntegrationHandlers(render, async (url, options) => {
    calls.push({ url, options });
    return response(201, { id: "created" });
  });
  await handlers.clickUpCreateTask({ apiToken: "click-token", listId: "list/1", name: "Task", description: "Details" }, {}, context());
  assert.equal(calls[0].options.headers.Authorization, "click-token");
  assert.match(calls[0].url, /list%2F1\/task$/);
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: "Task", description: "Details" });

  await handlers.gitlabCreateIssue({ token: "git-token", projectId: "group/project", title: "Bug", description: "Details" }, {}, context());
  assert.equal(calls[1].options.headers["PRIVATE-TOKEN"], "git-token");
  assert.equal(calls[1].options.body, "title=Bug&description=Details");
});

test("Linear, Shopify, and Stripe handlers parse successful responses", async () => {
  let call = 0;
  const handlers = makeIntegrationHandlers(render, async (url, options) => {
    call++;
    if (url.includes("linear")) return response(200, { data: { issueCreate: { success: true, issue: { identifier: "LIN-1" } } } });
    if (url.includes("shopify")) return response(201, { customer: { id: "shop-1" } });
    return response(200, { id: "cus-1" });
  });
  const ctx = context();
  assert.deepEqual(await handlers.linearCreateIssue({ apiKey: "linear-key", teamId: "team-1", title: "Issue" }, {}, ctx), { identifier: "LIN-1" });
  assert.deepEqual(await handlers.shopifyCreateCustomer({ shopDomain: "store.myshopify.com", accessToken: "shop-token", email: "a@example.com" }, {}, ctx), { id: "shop-1" });
  assert.deepEqual(await handlers.stripeCreateCustomer({ apiKey: "stripe-key", email: "a@example.com" }, {}, ctx), { id: "cus-1" });
  assert.equal(call, 3);
});

test("transient integration failures retry and then succeed", async () => {
  let attempts = 0;
  const handlers = makeIntegrationHandlers(render, async () => {
    attempts++;
    return attempts === 1 ? response(429, { error: "rate limited" }, { "retry-after": "0" }) : response(200, { id: "ok" });
  });
  const result = await handlers.stripeCreateCustomer({ apiKey: "stripe-key", email: "a@example.com" }, {}, context());
  assert.deepEqual(result, { id: "ok" });
  assert.equal(attempts, 2);
});

test("integration request timeout aborts a stalled provider request", async () => {
  await assert.rejects(
    () => requestWithTimeout(async (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }), "https://provider.test", {}, 5),
    /Request timed out after 5ms/
  );
});

test("all direct HTTP integration handlers execute through the provider request seam", async () => {
  const calls = [];
  const handlers = makeIntegrationHandlers(render, async (url, options) => {
    calls.push({ url, options });
    if (url.includes("linear")) return response(200, { data: { issueCreate: { success: true, issue: { id: "linear-1" } } } });
    if (url.includes("shopify")) return response(201, { customer: { id: "shopify-1" } });
    return response(200, { id: "ok", choices: [{ message: { content: "generated" } }] });
  });
  const contextWithCredentials = context();
  const cases = [
    ["slackMessage", { webhookUrl: "https://hooks.slack.com/services/test", text: "hello" }],
    ["discordMessage", { webhookUrl: "https://discord.com/api/webhooks/test", content: "hello" }],
    ["airtableCreateRecord", { apiKey: "airtable-key", baseId: "base", tableName: "Table", fieldsJson: "{}" }],
    ["microsoftTeamsMessage", { webhookUrl: "https://tenant.webhook.office.com/hook", text: "hello" }],
    ["clickUpCreateTask", { apiToken: "click-token", listId: "list", name: "Task" }],
    ["gitlabCreateIssue", { token: "git-token", projectId: "group/project", title: "Issue" }],
    ["linearCreateIssue", { apiKey: "linear-key", teamId: "team", title: "Issue" }],
    ["shopifyCreateCustomer", { shopDomain: "store.myshopify.com", accessToken: "shop-token", email: "a@example.com" }],
    ["stripeCreateCustomer", { apiKey: "stripe-key", email: "a@example.com" }],
    ["telegramMessage", { botToken: "bot-token", chatId: "chat", text: "hello" }],
    ["twilioSms", { accountSid: "AC123", authToken: "twilio-token", from: "+1000", to: "+2000", body: "hello" }],
    ["notionCreatePage", { apiKey: "notion-key", databaseId: "db", propertiesJson: "{}" }],
    ["trelloCreateCard", { apiKey: "trello-key", token: "trello-token", listId: "list", name: "Card" }],
    ["githubCreateIssue", { token: "github-token", owner: "owner", repo: "repo", title: "Issue" }],
    ["hubspotCreateContact", { apiKey: "hubspot-key", propertiesJson: "{}" }],
    ["mailchimpAddSubscriber", { apiKey: "mailchimp-key-us1", listId: "list", email: "a@example.com" }],
    ["googleCalendarCreateEvent", { serviceAccountJson: "not-json", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-01T01:00:00Z" }],
    ["asanaCreateTask", { token: "asana-token", projectId: "project", name: "Task" }],
    ["jiraCreateIssue", { email: "a@example.com", apiToken: "jira-token", domain: "example.atlassian.net", projectKey: "PROJ", summary: "Issue" }],
    ["openaiGenerateText", { apiKey: "openai-key", prompt: "hello" }],
    ["twilioWhatsapp", { accountSid: "AC123", authToken: "twilio-token", from: "+1000", to: "+2000", body: "hello" }],
  ];

  for (const [type, config] of cases) {
    if (type === "googleCalendarCreateEvent") {
      await assert.rejects(() => handlers[type](config, {}, contextWithCredentials), /valid JSON/);
      continue;
    }
    await handlers[type](config, {}, contextWithCredentials);
  }
  assert.equal(calls.length, cases.length - 1);
  assert.ok(calls.every(({ options }) => options.signal instanceof AbortSignal));
});