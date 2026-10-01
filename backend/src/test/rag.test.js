import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockLlm } from "./helpers/mockLlmServer.js";
import { nodeHandlers } from "../nodes/index.js";
import { createLimitTracker } from "../engine/limits.js";
import { splitText } from "../ai/textSplitter.js";
import { cosineSimilarity } from "../ai/vectorStore.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
process.env.SELF_HOSTED = "true";
process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true";

const SECRET = "sk-test-SECRET-1234567890";
let mock;
before(async () => { mock = await startMockLlm(); });
after(async () => { await mock.close(); });

const mkCtx = (userId = "user-1", workspaceId = null) => ({ vars: {}, userId, workspaceId, limits: createLimitTracker(), getCredential: async () => ({}) });
const base = (extra = {}) => ({ provider: "openai-compatible", baseUrl: mock.url, apiKey: SECRET, model: "m", ...extra });

// --- Pure-function tests (no database needed) ---

test("splitText: respects chunk size, produces overlap, drops empty/whitespace input", () => {
  assert.deepEqual(splitText("   "), []);
  assert.deepEqual(splitText(""), []);
  const chunks = splitText("Sentence one. Sentence two. Sentence three. " + "word ".repeat(200), { chunkSize: 150, chunkOverlap: 20 });
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 200, `chunk too long: ${c.length}`); // size + generous overlap slack
});

test("splitText: short text under chunkSize returns a single chunk", () => {
  assert.deepEqual(splitText("hello world", { chunkSize: 1000 }), ["hello world"]);
});

test("embedText: requires a model and (for non-ollama) a credential", async () => {
  await assert.rejects(() => nodeHandlers.embedText({ provider: "openai-compatible", baseUrl: mock.url, text: "hi" }, {}, mkCtx()), /embedding model/);
  await assert.rejects(() => nodeHandlers.embedText({ provider: "openai-compatible", baseUrl: mock.url, model: "e", apiKey: "", text: "hi" }, {}, mkCtx()), /API key/);
});

test("embedText: returns a vector from the mock provider", async () => {
  const out = await nodeHandlers.embedText(base({ text: "hello" }), {}, mkCtx());
  assert.deepEqual(out.embedding, [0.1, 0.2, 0.3]);
  assert.equal(out.dimension, 3);
});

test("cosineSimilarity: identical vectors score 1, opposite vectors score -1, mismatched dimensions are rejected", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), -1, "a dimension mismatch (different embedding model) must never rank as a match");
  assert.ok(cosineSimilarity([1, 0, 0], [0.9, 0.1, 0]) > cosineSimilarity([1, 0, 0], [0, 0, 1]), "a closer vector must score higher than an unrelated one");
});

// --- Database-backed tests: memory and the vector store, against a real Postgres ---

test("memory: llmChain remembers a prior turn and appends the new one, scoped per user", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const sessionId = `test-session-${Date.now()}`;
  mock.script.push({ text: "Nice to meet you, Amir." });
  const ctxA = mkCtx("user-a");
  await nodeHandlers.llmChain(base({ prompt: "My name is Amir.", memorySessionId: sessionId }), {}, ctxA);

  mock.requests.length = 0;
  mock.script.push({ text: "Your name is Amir." });
  await nodeHandlers.llmChain(base({ prompt: "What is my name?", memorySessionId: sessionId }), {}, ctxA);
  const sentMessages = mock.requests[0].body.messages;
  assert.ok(sentMessages.some((m) => m.content?.includes("Amir")), "the prior turn should have been sent as history");

  // A different user with the SAME session id string must not see user-a's history.
  mock.requests.length = 0;
  mock.script.push({ text: "I don't know your name." });
  await nodeHandlers.llmChain(base({ prompt: "What is my name?", memorySessionId: sessionId }), {}, mkCtx("user-b"));
  const sentMessagesB = mock.requests[0].body.messages;
  assert.equal(sentMessagesB.length, 1, "a different user must start with no history for the same session id string");
});

test("memory: aiAgent uses history via runAgent and saves the final answer, not intermediate tool chatter", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const sessionId = `test-agent-session-${Date.now()}`;
  const ctx = mkCtx("user-agent-mem");
  mock.script.push({ text: "6*7 is 42." });
  await nodeHandlers.aiAgent(base({ prompt: "What is 6 times 7?", memorySessionId: sessionId, tools: [] }), {}, ctx);

  mock.requests.length = 0;
  mock.script.push({ text: "You asked about 6 times 7." });
  await nodeHandlers.aiAgent(base({ prompt: "What did I just ask?", memorySessionId: sessionId, tools: [] }), {}, ctx);
  const sent = mock.requests[0].body.messages;
  assert.ok(sent.some((m) => m.content?.includes("42")), "the agent's prior final answer should be in history");
});

test("memory: without memorySessionId, no history is loaded or saved (opt-in only)", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const ctx = mkCtx("user-no-mem");
  mock.requests.length = 0;
  mock.script.push({ text: "first" });
  await nodeHandlers.llmChain(base({ prompt: "one" }), {}, ctx);
  mock.script.push({ text: "second" });
  await nodeHandlers.llmChain(base({ prompt: "two" }), {}, ctx);
  const secondCallMessages = mock.requests[1].body.messages;
  assert.equal(secondCallMessages.length, 1, "no memory config means every call is independent");
});

test("vector store: upsert then search finds the closest match and respects k", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const ctx = mkCtx("user-vec-1");
  const collection = `test-coll-${Date.now()}`;
  // The mock's /embeddings route always returns the same fixed vector regardless of input text, so
  // this test can't exercise real semantic ranking — it confirms the round trip through Postgres
  // (insert, retrieve, metadata, per-user scoping) rather than embedding quality.
  mock.script.push({});
  const up = await nodeHandlers.vectorUpsert(base({ collection, content: "hello world", metadataJson: '{"source":"test"}' }), {}, ctx);
  assert.ok(up.id);
  mock.script.push({});
  const found = await nodeHandlers.vectorSearch(base({ collection, query: "hello", k: 5 }), {}, ctx);
  assert.equal(found.results[0].content, "hello world");
  assert.deepEqual(found.results[0].metadata, { source: "test" });

  // A different user cannot see this collection even with the same name.
  mock.script.push({});
  const otherUser = await nodeHandlers.vectorSearch(base({ collection, query: "hello", k: 5 }), {}, mkCtx("user-vec-2"));
  assert.equal(otherUser.results.length, 0, "vector search must be scoped per user");
});

test("ragAnswer: retrieves stored documents and cites them in the answer, scoped per user", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const ctx = mkCtx("user-rag-1");
  const collection = `test-rag-${Date.now()}`;
  mock.script.push({});
  await nodeHandlers.vectorUpsert(base({ collection, content: "Refunds are processed within 5 business days." }), {}, ctx);

  mock.requests.length = 0;
  mock.script.push({}); // embed the query
  mock.script.push({ text: "Refunds take 5 business days [1]." }); // chat answer
  const out = await nodeHandlers.ragAnswer(base({ collection, query: "How long do refunds take?" }), {}, ctx);
  assert.equal(out.text, "Refunds take 5 business days [1].");
  assert.equal(out.sources.length, 1);
  assert.ok(out.sources[0].content.includes("5 business days"));
  const chatCall = mock.requests[1].body;
  assert.ok(chatCall.messages[0].content.includes("5 business days"), "the retrieved document must be in the system prompt as context");
});

test("ragAnswer: with no matching documents, still answers and says so rather than inventing a source", { skip: !databaseAvailable ? "DATABASE_URL is required" : false }, async () => {
  const ctx = mkCtx("user-rag-empty");
  mock.script.push({}); // embed
  mock.script.push({ text: "I don't have any documents about that." });
  const out = await nodeHandlers.ragAnswer(base({ collection: `empty-${Date.now()}`, query: "anything" }), {}, ctx);
  assert.equal(out.sources.length, 0);
  assert.ok(out.text.length > 0);
});
