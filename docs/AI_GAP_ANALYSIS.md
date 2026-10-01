# AI gap analysis (partial, honest)

**Method and limits.** This sandbox has no direct internet access. I used a search tool to read excerpts of n8n's documentation on 2026-09-28. I did not read n8n's GitHub issues, forum complaints or template gallery, so user complaints are NOT covered and everything below marked "from memory" is unverified. I do not claim parity with n8n anywhere.

## What n8n documents (verified from doc excerpts)

- n8n builds its AI features on LangChain JS, as "cluster nodes": a root node (agent, chain, vector store) with attached sub-nodes (source: docs.n8n.io/advanced-ai/langchain/langchain-n8n).
- Chat model sub-nodes listed there include Anthropic, AWS Bedrock, Cohere, Hugging Face Inference, Mistral Cloud, Ollama, OpenAI (same source).
- Vector stores listed there: Simple (in-memory), PGVector, Pinecone, Qdrant, Supabase, Zep; a Weaviate page also exists (same source, plus the Weaviate docs page).
- Memory sub-nodes attach to agents and store history with context windowing and session management; a Chat Memory Manager node loads, inserts and deletes messages (docs.n8n.io memory manager page).
- Vector stores can be attached to an agent as a tool, or used through a Vector Store Retriever with a Question and Answer chain (vector store node pages).
- An AI Agent Tool node lets a primary agent delegate to specialist agents, with optional output parsers and a fallback model (docs.n8n.io AI Agent Tool page).
- A Chat Trigger feeds user input to the agent (strapi.io guide, secondary source).

## Gap table (what I built vs. what exists)

| Capability | n8n (per docs above) | This repo now | Status |
|---|---|---|---|
| Multi-provider chat | many chat model sub-nodes | adapters: OpenAI, Anthropic, Gemini, Ollama, OpenAI-compatible | built; tested against a mock server only |
| LLM chain with structured output | yes (chains, output parsers) | `llmChain` node: system prompt, JSON schema validation with one repair retry, tokens, optional user-priced cost | built, mock-tested |
| Agent with tools | yes | `aiAgent` node: bounded loop; tools calculator, HTTP GET, sandboxed JS, read-only Postgres | built, mock-tested; no sub-workflow tool, no MCP |
| Step trace | execution view | every thought / tool call / tool result is in the node output (`trace`) | data recorded; **no dedicated trace UI built** |
| Memory | window + persistent sub-nodes | Postgres-backed, per-session, per-user-scoped, message-count retention only | built, mock-tested (real DB integration tests written, unverified in this sandbox) |
| Embeddings | yes | `embedText` node using provider `embed()` for OpenAI-compatible, Gemini, Ollama | built, mock-tested |
| Vector store / RAG / loaders / splitters | yes (several stores) | `splitText`, `vectorUpsert`, `vectorSearch`, `ragAnswer`; storage is a plain Postgres array column, not the pgvector extension (see docs/AI_NODES.md for why); no dedicated loader nodes, reuse HTTP/Postgres nodes instead | built, mock-tested for logic; real-DB integration tests written but unverified in this sandbox |
| MCP client / server trigger | yes (from memory, unverified) | not built | **missing** |
| Classifier / extractor / summarizer nodes | yes (from memory, unverified) | not built (`llmChain` with a JSON schema can approximate them) | **missing** |
| Chat Trigger + test chat | yes | not built | **missing** |
| AI templates | yes | not built | **missing** |
| Streaming | yes (from memory) | not implemented | **missing** |

## Where this repo aims to be better (and current honest status)

- Safer defaults: all outbound calls go through one SSRF-safe network layer; AI runs share per-execution limits (LLM calls, tokens, time). **Done and tested.**
- Local models: Ollama works when `SELF_HOSTED=true` and `ALLOW_PRIVATE_NETWORK_TARGETS=true`. **Tested against a mock, not a real Ollama.**
- Easy pgvector setup: deliberately **not** using pgvector at all (see docs/AI_NODES.md) so self-hosters with an ordinary Postgres aren't blocked; this trades away large-scale performance for zero setup and universal compatibility.
- Token visibility: usage is returned per node; cost only if you enter your own prices (no prices are shipped because they go stale). **Done.**
- Simpler UX, easy pgvector setup: **not built.**

## Prioritized next steps

1. Verify the memory and RAG features against a real database (written but unverified here; see VERIFICATION_REPORT.md).
2. Trace UI for agent steps; token/cost totals per workflow.
3. Chat Trigger + test chat; templates.
4. MCP client; classifier/extractor nodes; streaming.
5. If document volume outgrows the plain-array vector store, add pgvector-backed indexing behind a feature-detection check, without changing the node interface.
