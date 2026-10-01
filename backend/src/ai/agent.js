// Agent loop: model -> (tool calls -> observations)* -> final answer, bounded by
// maxIterations plus the shared per-execution limits (LLM calls, tokens, wall clock).
// Every step is recorded in `trace` so the execution log shows thought / tool call / result.
import { getProvider } from "./providers.js";

const MAX_TOOL_RESULT_CHARS = 8000;
const MAX_TOOL_CALLS_PER_TURN = 8;

export function truncate(text, max = MAX_TOOL_RESULT_CHARS) {
  const s = typeof text === "string" ? text : JSON.stringify(text);
  return s.length > max ? `${s.slice(0, max)}… [truncated ${s.length - max} chars]` : s;
}

/** Make one model call, charging the shared execution budget. */
export async function callModel(ctx, params) {
  ctx.limits?.llmCall();
  const provider = getProvider(params.provider);
  const result = await provider.chat(params);
  ctx.limits?.addTokens((result.usage?.inputTokens || 0) + (result.usage?.outputTokens || 0));
  return result;
}

export function estimateCost(usage, pricing) {
  const inP = Number(pricing?.inputPer1M), outP = Number(pricing?.outputPer1M);
  if (!Number.isFinite(inP) || !Number.isFinite(outP)) return null; // prices are user-supplied; we ship none (they go stale)
  return Number(((usage.inputTokens * inP + usage.outputTokens * outP) / 1_000_000).toFixed(6));
}

export async function runAgent(ctx, { model, tools, system, prompt, maxIterations = 8, history = [] }) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push(...history, { role: "user", content: prompt });
  const trace = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = "maxIterations";
  let finalText = "";

  for (let i = 0; i < maxIterations; i++) {
    const res = await callModel(ctx, { ...model, messages, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    if (res.text) trace.push({ step: trace.length + 1, iteration: i + 1, type: "thought", text: truncate(res.text, 4000) });
    if (!res.toolCalls.length) { finalText = res.text; stopReason = "final"; break; }
    finalText = res.text || finalText;
    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });
    for (const call of res.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TURN)) {
      trace.push({ step: trace.length + 1, iteration: i + 1, type: "toolCall", tool: call.name, arguments: call.arguments });
      const tool = toolMap.get(call.name);
      let observation;
      try {
        if (!tool) throw new Error(`Unknown tool "${call.name}". Available: ${[...toolMap.keys()].join(", ")}`);
        observation = truncate(await tool.run(call.arguments || {}, ctx));
      } catch (err) {
        if (err?.name === "LimitExceededError") throw err;
        observation = `Error: ${err.message}`;
      }
      trace.push({ step: trace.length + 1, iteration: i + 1, type: "toolResult", tool: call.name, result: observation });
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: observation });
    }
    // Any tool calls beyond the per-turn cap still need a reply so the transcript stays valid.
    for (const call of res.toolCalls.slice(MAX_TOOL_CALLS_PER_TURN)) {
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: "Error: too many tool calls in one turn; call skipped" });
    }
  }
  return { text: finalText, stopReason, trace, usage, messages };
}
