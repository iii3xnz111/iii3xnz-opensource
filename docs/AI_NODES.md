# AI nodes

Everything here is implemented and tested **only against a mock LLM server** (`backend/src/test/helpers/mockLlmServer.js`). No real provider, model name or price was called or verified. Check each provider's current API docs and model names yourself.

## Nodes

| Node type | What it does |
|---|---|
| `llmChain` ("AI: LLM Chain") | One prompt (with optional system prompt) to a model. Optional JSON Schema: output is parsed, validated, retried once, then fails clearly. Optional memory. Returns `text`, `json`, `usage`, `cost`. |
| `aiAgent` ("AI: Agent") | Model can call tools in a loop until it answers, hits `maxIterations` (default 8, max 25), or a per-execution limit. Optional memory. Returns `text`, `stopReason`, `trace`, `usage`, `cost`. |
| `splitText` ("AI: Split Text") | Recursive character splitter (paragraph → line → sentence → word → hard cut) for preparing long text before embedding. Returns `chunks`, `count`. |
| `embedText` ("AI: Embed Text") | Turns text into a vector with an embedding-capable provider. Returns `embedding`, `dimension`. |
| `vectorUpsert` ("AI: Store in Vector DB") | Embeds text and stores it (with optional JSON metadata) in a named, per-user collection. Returns `id`, `collection`, `dimension`. |
| `vectorSearch` ("AI: Vector Search") | Embeds a query and returns the most similar documents in a collection, ranked by cosine similarity. Returns `results`, `count`. |
| `ragAnswer` ("AI: Answer from Documents") | Runs a vector search, puts the results in the model's context as numbered sources, and asks it to answer citing them. Returns `text`, `sources`, `usage`, `cost`. |

Tools for `aiAgent` (comma-separated in `tools`): `calculator`, `http` (GET only, SSRF-safe), `code` (isolated-vm sandbox, no network, 2 s), `postgres` (read-only transaction; needs `postgresCredentialId`).

Trace steps are `{step, iteration, type: thought|toolCall|toolResult, ...}`.

## Memory

Set `memorySessionId` on `llmChain` or `aiAgent` (e.g. `{{input.chatId}}`) to remember past turns for that session. `memoryMaxMessages` (default 20, max 200) caps how many messages are kept — older ones are deleted automatically, but there is **no time-based expiry**: a session with few messages can persist indefinitely. Leave `memorySessionId` blank for no memory at all (the default; nothing is stored). Memory is stored in the `ai_chat_memory` table and is scoped by the authenticated user id from the execution context — a workflow cannot read another tenant's history even by reusing the same session-id string, because the scoping key is not something workflow config can set.

## Retrieval (RAG)

`vectorUpsert` stores content in a named "collection" (any string you choose, e.g. `"support-docs"`) along with its embedding, scoped per user the same way memory is. `vectorSearch` and `ragAnswer` can only ever search collections belonging to the same user — a different tenant using the same collection name gets an empty result, never someone else's documents.

Vectors are stored as a plain `double precision[]` Postgres column and similarity is computed in application code (cosine similarity), **not** the `pgvector` extension. This was a deliberate compatibility choice: `pgvector` isn't available on every managed Postgres or every self-hoster's existing database, and the schema migration runs on every server startup — a hard dependency on an unavailable extension would have stopped the *entire app* from starting for every user, not just RAG users. The trade-off is that a search scans every document in a collection (bounded at 5000 rows as a safety cap), so this is realistic for up to a few thousand documents per collection, not a large-scale document store. A future version could add `pgvector`-backed indexing behind a feature-detection check (try `CREATE EXTENSION`, fall back to this if it fails) without changing the node interface.

There is no dedicated "document loader" node for PDFs/URLs/CSVs — reuse the existing HTTP Request node (or Postgres node) to fetch content, then `splitText` → `vectorUpsert` to index it. This keeps the RAG pipeline composable with nodes you already have rather than adding several single-purpose loader nodes.

## Providers

| Provider id | Base URL | Credential |
|---|---|---|
| `openai` | default `https://api.openai.com/v1` | credential type "AI Provider API Key" |
| `anthropic` | default `https://api.anthropic.com` | same |
| `gemini` | default `https://generativelanguage.googleapis.com` | same |
| `ollama` | default `http://localhost:11434` (needs private-network opt-in) | none |
| `openai-compatible` | set `baseUrl` | same |

API keys come only from encrypted credentials (`credentialId`) or, as with the other nodes, the node's own `apiKey` field. `ragAnswer` accepts an optional second credential (`embeddingCredentialId`) so chat and embeddings can use different providers (e.g. Anthropic for chat, OpenAI for embeddings, since Anthropic has no embeddings API). Not implemented: streaming, MCP, document-loader nodes for specific file formats, a dedicated chat trigger/test-chat UI.

Cost: set `inputPricePer1M` and `outputPricePer1M` on the node to get a `cost` number; otherwise `cost` is `null`.

## Security model

- Every outbound request (HTTP node, SMTP, Postgres node, LLM base URLs, agent HTTP tool) uses `backend/src/net/safeNetwork.js`: blocks private/loopback/link-local/metadata IPs (including IPv4-mapped IPv6), resolves DNS once and pins that IP for the socket, re-validates each redirect, caps response size.
- Private targets (e.g. local Ollama) are allowed only when **both** `SELF_HOSTED=true` and `ALLOW_PRIVATE_NETWORK_TARGETS=true`.
- Per-execution limits (`backend/src/engine/limits.js`; env `EXECUTION_MAX_STEPS`, `..._WALL_CLOCK_MS`, `..._LOOP_ITERATIONS`, `..._LLM_CALLS`, `..._TOKENS`, `..._OUTPUT_BYTES`) are shared with sub-workflows and charged by AI nodes.
- Tool output is untrusted data and can contain prompt injection. Do not give an agent tools whose side effects you would not accept from an attacker who controls a web page it reads. The provided tools are read-only or sandboxed by design.
- Provider error text is scrubbed of the API key before it is thrown.

## Cloud plan placement

`backend/src/aiTiers.config.js` (one file) proposes: free none, starter `llmChain` + `splitText` + `embedText`, pro adds `aiAgent` + `vectorUpsert` + `vectorSearch` + `ragAnswer`, enterprise placeholder (not enforced). Self-hosted mode unlocks everything.

## Example (LLM chain)

```json
{ "type": "llmChain", "data": { "config": {
  "provider": "ollama", "baseUrl": "http://localhost:11434", "model": "<a model you pulled>",
  "prompt": "Classify: {{input.text}}",
  "schemaJson": "{\"type\":\"object\",\"required\":[\"label\"],\"properties\":{\"label\":{\"type\":\"string\"}}}" } } }
```

## Example (a minimal RAG pipeline)

```
[HTTP Request: fetch a doc] -> [AI: Split Text] -> [AI: Store in Vector DB, collection="docs"]
```
Then, in a separate workflow or later in the same one:
```
[AI: Answer from Documents, collection="docs", query="{{input.question}}"]
```
