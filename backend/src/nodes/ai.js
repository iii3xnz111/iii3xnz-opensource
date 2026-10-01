import { callModel, runAgent, estimateCost } from "../ai/agent.js";
import { validateJsonSchema } from "../ai/schema.js";
import { calculate } from "../ai/calculator.js";
import { safeFetch, readBodyCapped, safePgConfig } from "../net/safeNetwork.js";
import { getProvider } from "../ai/providers.js";
import { loadMemory, appendMemory } from "../ai/memory.js";
import { upsertDocument, similaritySearch } from "../ai/vectorStore.js";
import { splitText } from "../ai/textSplitter.js";

const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

async function withCredential(config, ctx) {
  let out = config.credentialId ? { ...config, ...(await ctx.getCredential(config.credentialId)) } : config;
  // A second, optional credential for embeddings (e.g. chat via Anthropic + embeddings via
  // OpenAI). Its fields land under an "embedding" prefix so they never collide with the chat
  // credential's own apiKey/baseUrl.
  if (out.embeddingCredentialId) {
    const embedCred = await ctx.getCredential(out.embeddingCredentialId);
    out = { ...out, embeddingApiKey: embedCred.apiKey, embeddingBaseUrl: embedCred.baseUrl ?? out.embeddingBaseUrl };
  }
  return out;
}

function modelParams(config) {
  if (!config.model) throw new Error("A model name is required");
  const provider = config.provider || "openai";
  if (provider !== "ollama" && !config.apiKey) throw new Error("An API key credential is required for this provider");
  return {
    provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl || undefined,
    temperature: config.temperature === "" || config.temperature == null ? undefined : clampNum(config.temperature, 0, 2, 0.7),
    maxTokens: clampNum(config.maxTokens, 1, 32000, 1024),
  };
}

function parseJsonLoose(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(t);
}

export function buildTools(config, { resolveTemplate, runSandboxedCode }, ctx) {
  const enabled = new Set(Array.isArray(config.tools) ? config.tools : String(config.tools || "").split(",").map((s) => s.trim()).filter(Boolean));
  const tools = [];
  if (enabled.has("calculator")) {
    tools.push({
      name: "calculator", description: "Evaluate an arithmetic expression such as (2+3)*4/5.",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
      run: async ({ expression }) => String(calculate(expression)),
    });
  }
  if (enabled.has("http")) {
    tools.push({
      name: "http_get", description: "Fetch a public http(s) URL with GET and return the response text (truncated). Cannot reach private networks.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      run: async ({ url }) => {
        const res = await safeFetch(String(url), { method: "GET", maxRedirects: 3, timeoutMs: 10000 });
        const body = (await readBodyCapped(res, 1024 * 1024)).toString("utf8");
        return `HTTP ${res.status}\n${body}`;
      },
    });
  }
  if (enabled.has("code")) {
    tools.push({
      name: "run_javascript", description: "Run a JavaScript snippet in a sandbox (no network, 2s limit). Use `return` to produce a value; `input` holds the node input.",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      run: async ({ code }, c) => JSON.stringify(await runSandboxedCode(String(code), { input: c.__agentInput ?? {}, vars: {} })),
    });
  }
  if (enabled.has("postgres")) {
    tools.push({
      name: "postgres_readonly_query", description: "Run a single read-only SQL query on the configured database and return up to 50 rows.",
      parameters: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
      run: async ({ sql }) => {
        const cred = config.postgresCredentialId ? await ctx.getCredential(config.postgresCredentialId) : null;
        if (!cred?.connectionString) throw new Error("No Postgres credential is configured for this agent");
        const { Client } = await import("pg");
        const client = new Client({ ...(await safePgConfig(cred.connectionString)), connectionTimeoutMillis: 10000, query_timeout: 15000 });
        try {
          await client.connect();
          await client.query("BEGIN READ ONLY");
          const r = await client.query(String(sql));
          return JSON.stringify(r.rows.slice(0, 50));
        } finally {
          await client.query("ROLLBACK").catch(() => {});
          await client.end().catch(() => {});
        }
      },
    });
  }
  return tools;
}

// `separateEmbedding: true` reads the embedding* fields set by withCredential() above
// (embeddingProvider, embeddingModel, embeddingApiKey, embeddingBaseUrl), falling back to the
// node's main provider/model/apiKey/baseUrl for anything not overridden — so the common case
// (one provider for both chat and embeddings) needs no extra config at all.
function embedParams(config, separateEmbedding = false) {
  const provider = (separateEmbedding && config.embeddingProvider) || config.provider || "openai";
  const model = (separateEmbedding && config.embeddingModel) || config.embeddingModel || config.model;
  if (!model) throw new Error("An embedding model name is required (set 'model' or 'embeddingModel')");
  const apiKey = (separateEmbedding && config.embeddingApiKey) || config.apiKey;
  const baseUrl = (separateEmbedding && config.embeddingBaseUrl) || config.baseUrl;
  if (provider !== "ollama" && !apiKey) throw new Error("An API key credential is required for this provider");
  return { provider, model, apiKey, baseUrl: baseUrl || undefined };
}

async function embedOne(config, text, separateEmbedding = false) {
  const params = embedParams(config, separateEmbedding);
  const provider = getProvider(params.provider);
  const { vectors } = await provider.embed({ ...params, input: [text] });
  if (!vectors?.[0]?.length) throw new Error("The embedding provider returned no vector");
  return vectors[0];
}

/** Memory config shared by llmChain and aiAgent: only active when memorySessionId is set. */
async function loadMemoryIfConfigured(config, input, ctx, resolveTemplate) {
  const sessionId = config.memorySessionId ? resolveTemplate(config.memorySessionId, input, ctx.vars) : "";
  if (!sessionId) return { sessionId: null, history: [] };
  const limit = clampNum(config.memoryMaxMessages, 1, 200, 20);
  const history = await loadMemory({ userId: ctx.userId, workspaceId: ctx.workspaceId, sessionId, limit });
  return { sessionId, history, limit };
}

async function saveMemoryTurn({ sessionId, limit }, ctx, userText, assistantText) {
  if (!sessionId) return;
  await appendMemory({ userId: ctx.userId, workspaceId: ctx.workspaceId, sessionId, role: "user", content: userText, limit });
  await appendMemory({ userId: ctx.userId, workspaceId: ctx.workspaceId, sessionId, role: "assistant", content: assistantText, limit });
}

export function makeAiHandlers(deps) {
  const { resolveTemplate } = deps;
  return {
    llmChain: async (rawConfig, input, ctx) => {
      const config = await withCredential(rawConfig, ctx);
      const prompt = resolveTemplate(config.prompt || "", input, ctx.vars);
      if (!prompt) throw new Error("A prompt is required");
      const system = resolveTemplate(config.systemPrompt || "", input, ctx.vars);
      let schema = null;
      if (config.schemaJson) {
        try { schema = typeof config.schemaJson === "string" ? JSON.parse(config.schemaJson) : config.schemaJson; }
        catch { throw new Error("Output schema must be valid JSON Schema"); }
      }
      const params = { ...modelParams(config), jsonMode: Boolean(schema || config.jsonMode) };
      const mem = await loadMemoryIfConfigured(config, input, ctx, resolveTemplate);
      const messages = [...(system ? [{ role: "system", content: system }] : []), ...mem.history, { role: "user", content: prompt }];
      const usage = { inputTokens: 0, outputTokens: 0 };
      let res = await callModel(ctx, { ...params, messages });
      usage.inputTokens += res.usage.inputTokens; usage.outputTokens += res.usage.outputTokens;
      let json;
      if (params.jsonMode) {
        for (let attempt = 0; ; attempt++) {
          let errors;
          try { json = parseJsonLoose(res.text); errors = schema ? validateJsonSchema(json, schema) : []; }
          catch { errors = ["output was not valid JSON"]; }
          if (!errors.length) break;
          if (attempt >= 1) throw new Error(`Model output failed validation: ${errors.slice(0, 5).join("; ")}`);
          messages.push({ role: "assistant", content: res.text }, { role: "user", content: `Your previous answer was invalid (${errors.slice(0, 5).join("; ")}). Reply again with only corrected JSON.` });
          res = await callModel(ctx, { ...params, messages });
          usage.inputTokens += res.usage.inputTokens; usage.outputTokens += res.usage.outputTokens;
        }
      }
      await saveMemoryTurn(mem, ctx, prompt, res.text);
      return { text: res.text, ...(json !== undefined ? { json } : {}), provider: params.provider, model: params.model, usage, cost: estimateCost(usage, { inputPer1M: config.inputPricePer1M, outputPer1M: config.outputPricePer1M }) };
    },

    aiAgent: async (rawConfig, input, ctx) => {
      const config = await withCredential(rawConfig, ctx);
      const prompt = resolveTemplate(config.prompt || "", input, ctx.vars);
      if (!prompt) throw new Error("A prompt is required");
      const system = resolveTemplate(config.systemPrompt || "You are a helpful assistant. Use tools when they help; stop when you can answer.", input, ctx.vars);
      const agentCtx = Object.assign(Object.create(ctx), { __agentInput: input });
      const tools = buildTools(config, deps, agentCtx);
      const params = modelParams(config);
      const mem = await loadMemoryIfConfigured(config, input, ctx, resolveTemplate);
      const result = await runAgent(agentCtx, { model: params, tools, system, prompt, history: mem.history, maxIterations: clampNum(config.maxIterations, 1, 25, 8) });
      await saveMemoryTurn(mem, ctx, prompt, result.text);
      return {
        text: result.text, stopReason: result.stopReason, trace: result.trace, provider: params.provider, model: params.model,
        usage: result.usage, cost: estimateCost(result.usage, { inputPer1M: config.inputPricePer1M, outputPer1M: config.outputPricePer1M }),
      };
    },

    // --- RAG: split text, embed it, store it in Postgres, search it, and a convenience node
    // that does search + answer in one step. See src/ai/vectorStore.js for the storage design.

    splitText: async (rawConfig, input, ctx) => {
      const config = rawConfig;
      const text = resolveTemplate(config.text || "", input, ctx.vars) || (typeof input === "string" ? input : "");
      if (!text.trim()) throw new Error("There is no text to split (set 'text' or pass a string as input)");
      const chunks = splitText(text, { chunkSize: config.chunkSize, chunkOverlap: config.chunkOverlap });
      return { chunks, count: chunks.length };
    },

    embedText: async (rawConfig, input, ctx) => {
      const config = await withCredential(rawConfig, ctx);
      const text = resolveTemplate(config.text || "", input, ctx.vars) || (typeof input === "string" ? input : "");
      if (!text.trim()) throw new Error("There is no text to embed (set 'text' or pass a string as input)");
      ctx.limits?.llmCall();
      const embedding = await embedOne(config, text);
      return { embedding, dimension: embedding.length };
    },

    vectorUpsert: async (rawConfig, input, ctx) => {
      const config = await withCredential(rawConfig, ctx);
      const collection = resolveTemplate(config.collection || "", input, ctx.vars);
      const content = resolveTemplate(config.content || "", input, ctx.vars) || (typeof input === "string" ? input : "");
      if (!content.trim()) throw new Error("There is no content to store (set 'content' or pass a string as input)");
      let metadata = {};
      if (config.metadataJson) {
        try { metadata = typeof config.metadataJson === "string" ? JSON.parse(config.metadataJson) : config.metadataJson; }
        catch { throw new Error("metadata must be valid JSON"); }
      }
      ctx.limits?.llmCall();
      const embedding = await embedOne(config, content);
      const { id } = await upsertDocument({ userId: ctx.userId, workspaceId: ctx.workspaceId, collection, content, embedding, metadata });
      return { id, collection, dimension: embedding.length };
    },

    vectorSearch: async (rawConfig, input, ctx) => {
      const config = await withCredential(rawConfig, ctx);
      const collection = resolveTemplate(config.collection || "", input, ctx.vars);
      const query = resolveTemplate(config.query || "", input, ctx.vars) || (typeof input === "string" ? input : "");
      if (!query.trim()) throw new Error("A query is required (set 'query' or pass a string as input)");
      ctx.limits?.llmCall();
      const queryEmbedding = await embedOne(config, query);
      const results = await similaritySearch({ userId: ctx.userId, collection, queryEmbedding, k: clampNum(config.k, 1, 50, 4) });
      return { results, count: results.length };
    },

    ragAnswer: async (rawConfig, input, ctx) => {
      const config = await withCredential(rawConfig, ctx);
      const collection = resolveTemplate(config.collection || "", input, ctx.vars);
      const query = resolveTemplate(config.query || "", input, ctx.vars) || (typeof input === "string" ? input : "");
      if (!query.trim()) throw new Error("A query is required (set 'query' or pass a string as input)");
      ctx.limits?.llmCall();
      const queryEmbedding = await embedOne(config, query, true);
      const sources = await similaritySearch({ userId: ctx.userId, collection, queryEmbedding, k: clampNum(config.k, 1, 20, 4) });
      const context = sources.length
        ? sources.map((s, i) => `[${i + 1}] ${s.content}`).join("\n\n")
        : "(no matching documents were found in this collection)";
      const system = resolveTemplate(
        config.systemPrompt ||
        "Answer the question using only the numbered sources below. Cite sources like [1]. If the sources don't contain the answer, say so plainly instead of guessing.\n\n{{input.__ragContext}}",
        { ...input, __ragContext: context },
        ctx.vars
      );
      const params = modelParams(config);
      const usage = { inputTokens: 0, outputTokens: 0 };
      const res = await callModel(ctx, { ...params, messages: [{ role: "system", content: system }, { role: "user", content: query }] });
      usage.inputTokens += res.usage.inputTokens; usage.outputTokens += res.usage.outputTokens;
      return {
        text: res.text, sources, provider: params.provider, model: params.model, usage,
        cost: estimateCost(usage, { inputPer1M: config.inputPricePer1M, outputPer1M: config.outputPricePer1M }),
      };
    },
  };
}
