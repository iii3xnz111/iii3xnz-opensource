// Mock LLM server for tests. Speaks minimal OpenAI, Anthropic, Gemini and Ollama wire formats.
// Tests script replies with `script.push(reply)` where reply is
//   { text?, toolCalls?: [{name, arguments}], usage?: {in, out}, status?, error? }
// Never calls a real provider. Records every request (headers + body) in `requests`.
import http from "node:http";

export async function startMockLlm() {
  const requests = [];
  const script = [];
  let fallback = { text: "mock reply", usage: { in: 5, out: 3 } };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch {}
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const reply = script.length ? script.shift() : fallback;
      const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (reply.status && reply.status >= 400) return send(reply.status, { error: { message: reply.error || "mock failure" } });
      const u = reply.usage || { in: 1, out: 1 };
      const calls = reply.toolCalls || [];
      if (req.url.endsWith("/chat/completions")) {
        return send(200, { choices: [{ finish_reason: calls.length ? "tool_calls" : "stop", message: { role: "assistant", content: reply.text ?? null, ...(calls.length ? { tool_calls: calls.map((c, i) => ({ id: `call_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) } }], usage: { prompt_tokens: u.in, completion_tokens: u.out } });
      }
      if (req.url.endsWith("/v1/messages")) {
        return send(200, { stop_reason: calls.length ? "tool_use" : "end_turn", content: [...(reply.text ? [{ type: "text", text: reply.text }] : []), ...calls.map((c, i) => ({ type: "tool_use", id: `toolu_${i}`, name: c.name, input: c.arguments }))], usage: { input_tokens: u.in, output_tokens: u.out } });
      }
      if (req.url.includes(":generateContent")) {
        return send(200, { candidates: [{ finishReason: "STOP", content: { parts: [...(reply.text ? [{ text: reply.text }] : []), ...calls.map((c) => ({ functionCall: { name: c.name, args: c.arguments } }))] } }], usageMetadata: { promptTokenCount: u.in, candidatesTokenCount: u.out } });
      }
      if (req.url.endsWith("/api/chat")) {
        return send(200, { done_reason: "stop", message: { role: "assistant", content: reply.text || "", ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) } : {}) }, prompt_eval_count: u.in, eval_count: u.out });
      }
      if (req.url.endsWith("/embeddings") || req.url.endsWith("/api/embed")) {
        return send(200, { data: [{ embedding: [0.1, 0.2, 0.3] }], embeddings: [[0.1, 0.2, 0.3]], usage: { prompt_tokens: 2 } });
      }
      return send(404, { error: { message: "unknown route" } });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests, script,
    setFallback: (r) => { fallback = r; },
    close: () => new Promise((r) => server.close(r)),
  };
}
