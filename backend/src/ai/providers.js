// Provider abstraction: one internal interface for chat + tool calling + structured output
// (+ embeddings where the provider offers them). Adapters: openai, anthropic, gemini, ollama,
// openai-compatible (custom base URL). Keys are supplied by the caller from encrypted
// credentials only; every outbound call goes through safeFetch (SSRF-safe, IP-pinned).
//
// Internal message shape:
//   { role: "system"|"user"|"assistant"|"tool", content: string,
//     toolCalls?: [{id, name, arguments: object}],   // on assistant messages
//     toolCallId?: string, name?: string }            // on tool messages
// chat() result: { text, toolCalls: [{id,name,arguments}], usage: {inputTokens,outputTokens}, finishReason }
// Streaming is NOT implemented (documented in docs/AI_NODES.md).
import { safeFetch, readBodyCapped } from "../net/safeNetwork.js";

export class ProviderError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  ollama: "http://localhost:11434",
};

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function scrub(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  return out;
}

async function postJson(url, headers, body, { secrets = [], timeoutMs = 60000 } = {}) {
  let res;
  try {
    res = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      maxRedirects: 0,
      timeoutMs,
    });
  } catch (err) {
    throw new ProviderError(scrub(err.message, secrets));
  }
  const text = (await readBodyCapped(res, MAX_RESPONSE_BYTES)).toString("utf8");
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || data?.message || text.slice(0, 300);
    throw new ProviderError(scrub(`Provider error (${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`, secrets), { status: res.status });
  }
  return data;
}

const parseArgs = (raw) => {
  if (raw && typeof raw === "object") return raw;
  try { return raw ? JSON.parse(raw) : {}; } catch { return { __invalidJson: String(raw).slice(0, 200) }; }
};

function toOpenAiMessages(messages) {
  return messages.map((m) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

const openAiTools = (tools) => tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description || "", parameters: t.parameters || { type: "object", properties: {} } } }));

function makeOpenAiLike(kind) {
  return {
    kind,
    async chat({ apiKey, baseUrl, model, messages, tools = [], temperature, maxTokens, jsonMode, timeoutMs }) {
      const body = { model, messages: toOpenAiMessages(messages) };
      if (temperature != null) body.temperature = temperature;
      if (maxTokens) body.max_tokens = maxTokens;
      if (tools.length) body.tools = openAiTools(tools);
      if (jsonMode) body.response_format = { type: "json_object" };
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const data = await postJson(`${(baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "")}/chat/completions`, headers, body, { secrets: [apiKey], timeoutMs });
      const choice = data.choices?.[0];
      if (!choice) throw new ProviderError("Provider returned no choices");
      return {
        text: choice.message?.content || "",
        toolCalls: (choice.message?.tool_calls || []).map((c) => ({ id: c.id, name: c.function?.name, arguments: parseArgs(c.function?.arguments) })),
        usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
        finishReason: choice.finish_reason,
      };
    },
    async embed({ apiKey, baseUrl, model, input, timeoutMs }) {
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const data = await postJson(`${(baseUrl || DEFAULT_BASE_URLS.openai).replace(/\/$/, "")}/embeddings`, headers, { model, input }, { secrets: [apiKey], timeoutMs });
      return { vectors: (data.data || []).map((d) => d.embedding), usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: 0 } };
    },
  };
}

const anthropic = {
  kind: "anthropic",
  async chat({ apiKey, baseUrl, model, messages, tools = [], temperature, maxTokens, jsonMode, timeoutMs }) {
    let system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    if (jsonMode) system += "\n\nRespond with a single valid JSON object and nothing else.";
    const out = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
        const last = out[out.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") last.content.push(block);
        else out.push({ role: "user", content: [block] });
      } else if (m.role === "assistant" && m.toolCalls?.length) {
        out.push({ role: "assistant", content: [...(m.content ? [{ type: "text", text: m.content }] : []), ...m.toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.arguments ?? {} }))] });
      } else {
        out.push({ role: m.role, content: m.content });
      }
    }
    const body = { model, max_tokens: maxTokens || 1024, messages: out };
    if (system) body.system = system;
    if (temperature != null) body.temperature = temperature;
    if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description || "", input_schema: t.parameters || { type: "object", properties: {} } }));
    const data = await postJson(`${(baseUrl || DEFAULT_BASE_URLS.anthropic).replace(/\/$/, "")}/v1/messages`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body, { secrets: [apiKey], timeoutMs });
    const blocks = data.content || [];
    return {
      text: blocks.filter((b) => b.type === "text").map((b) => b.text).join(""),
      toolCalls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, arguments: b.input || {} })),
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      finishReason: data.stop_reason,
    };
  },
  async embed() { throw new ProviderError("Anthropic does not offer an embeddings API; use OpenAI, Gemini or Ollama for embeddings"); },
};

const gemini = {
  kind: "gemini",
  async chat({ apiKey, baseUrl, model, messages, tools = [], temperature, maxTokens, jsonMode, timeoutMs }) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const nameById = new Map();
    const contents = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        contents.push({ role: "user", parts: [{ functionResponse: { name: m.name || nameById.get(m.toolCallId) || "tool", response: { result: m.content } } }] });
      } else if (m.role === "assistant" && m.toolCalls?.length) {
        m.toolCalls.forEach((c) => nameById.set(c.id, c.name));
        contents.push({ role: "model", parts: [...(m.content ? [{ text: m.content }] : []), ...m.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.arguments ?? {} } }))] });
      } else {
        contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
      }
    }
    const body = { contents, generationConfig: {} };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (temperature != null) body.generationConfig.temperature = temperature;
    if (maxTokens) body.generationConfig.maxOutputTokens = maxTokens;
    if (jsonMode) body.generationConfig.responseMimeType = "application/json";
    if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description || "", parameters: t.parameters || { type: "object", properties: {} } })) }];
    const url = `${(baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const data = await postJson(url, { "x-goog-api-key": apiKey }, body, { secrets: [apiKey], timeoutMs });
    const cand = data.candidates?.[0];
    if (!cand) throw new ProviderError("Provider returned no candidates");
    const parts = cand.content?.parts || [];
    return {
      text: parts.filter((p) => p.text).map((p) => p.text).join(""),
      toolCalls: parts.filter((p) => p.functionCall).map((p, i) => ({ id: `call_${i}_${p.functionCall.name}`, name: p.functionCall.name, arguments: p.functionCall.args || {} })),
      usage: { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
      finishReason: cand.finishReason,
    };
  },
  async embed({ apiKey, baseUrl, model, input, timeoutMs }) {
    const inputs = Array.isArray(input) ? input : [input];
    const base = (baseUrl || DEFAULT_BASE_URLS.gemini).replace(/\/$/, "");
    const data = await postJson(`${base}/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, { "x-goog-api-key": apiKey }, {
      requests: inputs.map((text) => ({ model: `models/${model}`, content: { parts: [{ text }] } })),
    }, { secrets: [apiKey], timeoutMs });
    return { vectors: (data.embeddings || []).map((e) => e.values), usage: { inputTokens: 0, outputTokens: 0 } };
  },
};

const ollama = {
  kind: "ollama",
  async chat({ baseUrl, model, messages, tools = [], temperature, maxTokens, jsonMode, timeoutMs }) {
    const msgs = messages.map((m) => {
      if (m.role === "tool") return { role: "tool", content: m.content, tool_name: m.name };
      if (m.role === "assistant" && m.toolCalls?.length) return { role: "assistant", content: m.content || "", tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments ?? {} } })) };
      return { role: m.role, content: m.content };
    });
    const body = { model, messages: msgs, stream: false, options: {} };
    if (temperature != null) body.options.temperature = temperature;
    if (maxTokens) body.options.num_predict = maxTokens;
    if (tools.length) body.tools = openAiTools(tools);
    if (jsonMode) body.format = "json";
    const data = await postJson(`${(baseUrl || DEFAULT_BASE_URLS.ollama).replace(/\/$/, "")}/api/chat`, {}, body, { timeoutMs: timeoutMs || 120000 });
    return {
      text: data.message?.content || "",
      toolCalls: (data.message?.tool_calls || []).map((c, i) => ({ id: `call_${i}_${c.function?.name}`, name: c.function?.name, arguments: parseArgs(c.function?.arguments) })),
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      finishReason: data.done_reason,
    };
  },
  async embed({ baseUrl, model, input, timeoutMs }) {
    const data = await postJson(`${(baseUrl || DEFAULT_BASE_URLS.ollama).replace(/\/$/, "")}/api/embed`, {}, { model, input }, { timeoutMs });
    return { vectors: data.embeddings || [], usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: 0 } };
  },
};

export const PROVIDERS = {
  openai: makeOpenAiLike("openai"),
  "openai-compatible": makeOpenAiLike("openai-compatible"),
  anthropic,
  gemini,
  ollama,
};

export function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new ProviderError(`Unknown provider "${name}". Supported: ${Object.keys(PROVIDERS).join(", ")}`);
  return p;
}
