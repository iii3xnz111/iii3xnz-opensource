import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockLlm } from "./helpers/mockLlmServer.js";
import { PROVIDERS, getProvider, ProviderError } from "../ai/providers.js";
import { validateJsonSchema } from "../ai/schema.js";
import { calculate } from "../ai/calculator.js";
import { nodeHandlers } from "../nodes/index.js";
import { executeWorkflow } from "../engine/executeWorkflow.js";
import { createLimitTracker } from "../engine/limits.js";

// The mock server lives on loopback, which is blocked by default. Opt in exactly the way a
// self-hoster running Ollama would.
process.env.SELF_HOSTED = "true";
process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true";

let mock;
before(async () => { mock = await startMockLlm(); });
after(async () => { await mock.close(); });

const SECRET = "sk-test-SECRET-1234567890";
const mkCtx = (overrides = {}) => ({ vars: {}, limits: createLimitTracker(overrides), getCredential: async () => ({}) });
const base = (extra = {}) => ({ provider: "openai-compatible", baseUrl: mock.url, apiKey: SECRET, model: "m", prompt: "hi", ...extra });

test("calculator: correct precedence, and rejects code injection", () => {
  assert.equal(calculate("(2+3)*4/5"), 4);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("-3 + 10 % 4"), -1);
  assert.throws(() => calculate("process.exit()"), /Unexpected token/);
  assert.throws(() => calculate("1/0"), /Division by zero/);
});

test("schema validator: types, required, enum, nested, additionalProperties", () => {
  const schema = { type: "object", required: ["a"], additionalProperties: false, properties: { a: { type: "integer" }, b: { enum: ["x", "y"] }, c: { type: "array", items: { type: "string" } } } };
  assert.deepEqual(validateJsonSchema({ a: 1, b: "x", c: ["s"] }, schema), []);
  assert.ok(validateJsonSchema({ b: "z" }, schema).length >= 2);
  assert.ok(validateJsonSchema({ a: 1.5 }, schema)[0].includes("expected integer"));
  assert.ok(validateJsonSchema({ a: 1, extra: 1 }, schema)[0].includes("unexpected"));
});

test("adapters: openai-compatible, anthropic, gemini, ollama return the same normalized shape", async () => {
  const tools = [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }];
  for (const provider of ["openai-compatible", "anthropic", "gemini", "ollama"]) {
    mock.script.push({ text: "hello", toolCalls: [{ name: "t", arguments: { k: 1 } }], usage: { in: 11, out: 7 } });
    const r = await getProvider(provider).chat({ apiKey: SECRET, baseUrl: mock.url, model: "m", messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }], tools });
    assert.equal(r.text, "hello", provider);
    assert.equal(r.toolCalls[0].name, "t", provider);
    assert.deepEqual(r.toolCalls[0].arguments, { k: 1 }, provider);
    assert.deepEqual(r.usage, { inputTokens: 11, outputTokens: 7 }, provider);
  }
});

test("adapters send credentials in the provider-specific header, never in the body or URL", async () => {
  mock.requests.length = 0;
  for (const provider of ["openai-compatible", "anthropic", "gemini"]) {
    await getProvider(provider).chat({ apiKey: SECRET, baseUrl: mock.url, model: "m", messages: [{ role: "user", content: "u" }] });
  }
  const [o, a, g] = mock.requests;
  assert.equal(o.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(a.headers["x-api-key"], SECRET);
  assert.equal(g.headers["x-goog-api-key"], SECRET);
  for (const r of mock.requests) { assert.ok(!r.url.includes(SECRET)); assert.ok(!JSON.stringify(r.body).includes(SECRET)); }
});

test("adapters: tool results are mapped into each provider's format", async () => {
  mock.requests.length = 0;
  const messages = [
    { role: "user", content: "q" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "t", arguments: { a: 1 } }] },
    { role: "tool", toolCallId: "c1", name: "t", content: "result" },
  ];
  for (const provider of ["openai-compatible", "anthropic", "gemini", "ollama"]) await getProvider(provider).chat({ apiKey: SECRET, baseUrl: mock.url, model: "m", messages });
  const [o, a, g, l] = mock.requests.map((r) => r.body);
  assert.equal(o.messages[2].role, "tool");
  assert.equal(a.messages[2].content[0].type, "tool_result");
  assert.ok(g.contents[2].parts[0].functionResponse);
  assert.equal(l.messages[2].role, "tool");
});

test("provider errors never leak the API key", async () => {
  mock.script.push({ status: 401, error: `bad key ${SECRET}` });
  await assert.rejects(() => getProvider("openai-compatible").chat({ apiKey: SECRET, baseUrl: mock.url, model: "m", messages: [{ role: "user", content: "u" }] }), (e) => e instanceof ProviderError && e.status === 401 && !e.message.includes(SECRET) && e.message.includes("[redacted]"));
});

test("embeddings: openai-compatible and ollama supported; anthropic refuses clearly", async () => {
  const a = await PROVIDERS["openai-compatible"].embed({ apiKey: SECRET, baseUrl: mock.url, model: "e", input: ["x"] });
  assert.deepEqual(a.vectors[0], [0.1, 0.2, 0.3]);
  const b = await PROVIDERS.ollama.embed({ baseUrl: mock.url, model: "e", input: ["x"] });
  assert.equal(b.vectors.length, 1);
  await assert.rejects(() => PROVIDERS.anthropic.embed({}), /does not offer an embeddings API/);
});

test("LLM URL targets: private/metadata base URLs are blocked unless self-hosted opt-in is set", async () => {
  const saved = process.env.ALLOW_PRIVATE_NETWORK_TARGETS;
  try {
    process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "false";
    for (const baseUrl of [mock.url, "http://169.254.169.254", "http://10.0.0.1:11434", "http://localhost:11434"]) {
      await assert.rejects(() => getProvider("ollama").chat({ baseUrl, model: "m", messages: [{ role: "user", content: "u" }] }), /internal\/private network|localhost/, baseUrl);
    }
  } finally { process.env.ALLOW_PRIVATE_NETWORK_TARGETS = saved; }
});

test("llmChain: returns text, usage and user-supplied cost; sends system prompt", async () => {
  mock.requests.length = 0;
  mock.script.push({ text: "Paris", usage: { in: 1000, out: 500 } });
  const out = await nodeHandlers.llmChain(base({ systemPrompt: "Be brief", prompt: "Capital of {{input.c}}?", inputPricePer1M: 2, outputPricePer1M: 4 }), { c: "France" }, mkCtx());
  assert.equal(out.text, "Paris");
  assert.deepEqual(out.usage, { inputTokens: 1000, outputTokens: 500 });
  assert.equal(out.cost, 0.004);
  assert.equal(mock.requests[0].body.messages[0].content, "Be brief");
  assert.equal(mock.requests[0].body.messages[1].content, "Capital of France?");
  assert.ok(!JSON.stringify(out).includes(SECRET));
});

test("llmChain: cost is null when no prices are configured (no invented prices)", async () => {
  mock.script.push({ text: "x" });
  assert.equal((await nodeHandlers.llmChain(base(), {}, mkCtx())).cost, null);
});

test("llmChain: structured output is validated; one repair retry; then fails clearly", async () => {
  const schemaJson = JSON.stringify({ type: "object", required: ["n"], properties: { n: { type: "integer" } } });
  mock.script.push({ text: '{"n":"oops"}' }, { text: '```json\n{"n": 3}\n```' });
  const ok = await nodeHandlers.llmChain(base({ schemaJson }), {}, mkCtx());
  assert.deepEqual(ok.json, { n: 3 });
  mock.script.push({ text: "not json" }, { text: "still not json" });
  await assert.rejects(() => nodeHandlers.llmChain(base({ schemaJson }), {}, mkCtx()), /failed validation/);
});

test("llmChain: requires model, prompt and (non-ollama) API key", async () => {
  await assert.rejects(() => nodeHandlers.llmChain(base({ model: "" }), {}, mkCtx()), /model name/);
  await assert.rejects(() => nodeHandlers.llmChain(base({ prompt: "" }), {}, mkCtx()), /prompt is required/);
  await assert.rejects(() => nodeHandlers.llmChain(base({ apiKey: "" }), {}, mkCtx()), /API key/);
});

test("llmChain: credentials come from ctx.getCredential", async () => {
  mock.requests.length = 0;
  mock.script.push({ text: "ok" });
  const ctx = { ...mkCtx(), getCredential: async (id) => { assert.equal(id, "cred-1"); return { apiKey: SECRET }; } };
  await nodeHandlers.llmChain({ provider: "openai-compatible", baseUrl: mock.url, model: "m", prompt: "hi", credentialId: "cred-1" }, {}, ctx);
  assert.equal(mock.requests[0].headers.authorization, `Bearer ${SECRET}`);
});

test("aiAgent: reason -> tool call -> observe -> final answer, with a full trace", async () => {
  mock.requests.length = 0;
  mock.script.push(
    { text: "I need to compute this", toolCalls: [{ name: "calculator", arguments: { expression: "6*7" } }], usage: { in: 10, out: 5 } },
    { text: "The answer is 42", usage: { in: 20, out: 6 } }
  );
  const out = await nodeHandlers.aiAgent(base({ tools: ["calculator"], prompt: "6*7?" }), {}, mkCtx());
  assert.equal(out.text, "The answer is 42");
  assert.equal(out.stopReason, "final");
  assert.deepEqual(out.trace.map((s) => s.type), ["thought", "toolCall", "toolResult", "thought"]);
  assert.equal(out.trace[2].result, "42");
  assert.deepEqual(out.usage, { inputTokens: 30, outputTokens: 11 });
  // the tool result was fed back to the model
  assert.equal(mock.requests[1].body.messages.at(-1).role, "tool");
  assert.equal(mock.requests[1].body.messages.at(-1).content, "42");
  assert.ok(!JSON.stringify(out).includes(SECRET));
});

test("aiAgent: unknown tool and tool errors become observations, not crashes", async () => {
  mock.script.push({ toolCalls: [{ name: "nope", arguments: {} }, { name: "calculator", arguments: { expression: "1/0" } }] }, { text: "done" });
  const out = await nodeHandlers.aiAgent(base({ tools: ["calculator"] }), {}, mkCtx());
  const results = out.trace.filter((s) => s.type === "toolResult").map((s) => s.result);
  assert.match(results[0], /Unknown tool "nope"/);
  assert.match(results[1], /Division by zero/);
  assert.equal(out.stopReason, "final");
});

test("aiAgent: infinite tool-calling loop stops at maxIterations", async () => {
  mock.setFallback({ toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }], usage: { in: 1, out: 1 } });
  try {
    const out = await nodeHandlers.aiAgent(base({ tools: ["calculator"], maxIterations: 4 }), {}, mkCtx());
    assert.equal(out.stopReason, "maxIterations");
    assert.equal(out.trace.filter((s) => s.type === "toolCall").length, 4);
  } finally { mock.setFallback({ text: "mock reply", usage: { in: 5, out: 3 } }); }
});

test("aiAgent: shared execution budget (LLM calls) aborts a runaway agent even with a high maxIterations", async () => {
  mock.setFallback({ toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }] });
  try {
    await assert.rejects(() => nodeHandlers.aiAgent(base({ tools: ["calculator"], maxIterations: 25 }), {}, mkCtx({ maxLlmCalls: 3 })), (e) => e.name === "LimitExceededError" && e.limit === "maxLlmCalls");
    await assert.rejects(() => nodeHandlers.aiAgent(base({ tools: ["calculator"], maxIterations: 25 }), {}, mkCtx({ maxTokens: 5 })), (e) => e.limit === "maxTokens");
  } finally { mock.setFallback({ text: "mock reply", usage: { in: 5, out: 3 } }); }
});

test("aiAgent: http tool cannot reach private addresses when private targets are disallowed", async () => {
  mock.script.push({ toolCalls: [{ name: "http_get", arguments: { url: "http://169.254.169.254/latest/meta-data/" } }] }, { text: "done" });
  const saved = process.env.ALLOW_PRIVATE_NETWORK_TARGETS;
  // Provider call needs the loopback mock, so flip the guard only around the tool by using a custom tool run:
  // run the tool directly instead.
  process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "false";
  try {
    const { buildTools } = await import("../nodes/ai.js");
    const [tool] = buildTools({ tools: ["http"] }, { resolveTemplate: (s) => s, runSandboxedCode: async () => null }, mkCtx());
    await assert.rejects(() => tool.run({ url: "http://169.254.169.254/latest/meta-data/" }), /internal\/private network/);
    await assert.rejects(() => tool.run({ url: "http://[::ffff:10.0.0.1]/" }), /internal\/private network/);
  } finally { process.env.ALLOW_PRIVATE_NETWORK_TARGETS = saved; mock.script.length = 0; }
});

test("aiAgent: code tool runs in the sandbox with the node input", async () => {
  mock.script.push({ toolCalls: [{ name: "run_javascript", arguments: { code: "return input.n * 2;" } }] }, { text: "ok" });
  const out = await nodeHandlers.aiAgent(base({ tools: ["code"] }), { n: 21 }, mkCtx());
  assert.equal(out.trace.find((s) => s.type === "toolResult").result, "42");
});

test("engine end-to-end: workflow with llmChain then aiAgent runs against the mock and charges one shared budget", async () => {
  mock.script.push({ text: "summary text", usage: { in: 4, out: 4 } }, { toolCalls: [{ name: "calculator", arguments: { expression: "2+2" } }], usage: { in: 4, out: 4 } }, { text: "four", usage: { in: 4, out: 4 } });
  const def = {
    nodes: [
      { id: "t", type: "manualTrigger", data: { config: {} } },
      { id: "chain", type: "llmChain", data: { config: base({ prompt: "summarise" }) } },
      { id: "agent", type: "aiAgent", data: { config: base({ tools: ["calculator"], prompt: "add {{input.text}}" }) } },
    ],
    edges: [{ source: "t", target: "chain" }, { source: "chain", target: "agent" }],
  };
  const result = await executeWorkflow(def, {}, null);
  assert.equal(result.log.find((l) => l.nodeId === "agent").output.text, "four");
  assert.ok(!JSON.stringify(result.log).includes(SECRET), "API key must not appear in the execution log");
  // budget shared: 3 LLM calls total > cap of 2 => abort
  mock.script.push({ text: "a" }, { toolCalls: [{ name: "calculator", arguments: { expression: "1" } }] }, { text: "c" });
  await assert.rejects(() => executeWorkflow(def, {}, null, 0, { limits: { maxLlmCalls: 2 } }), /LLM-call limit/);
});
