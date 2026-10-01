# Changes

## Track 1: licensing
Added LICENSE.md, LICENSE_EE.md, EE_FILES.md, COMMERCIAL-LICENSING.md, LEGAL_REVIEW_NEEDED.md; moved Apache text to docs/legal/; Enterprise headers on 6 files; package.json `license` fields; README license section and wording; CONTRIBUTING DCO + relicensing grant; THIRD-PARTY-NOTICES header; checklist, release-notes template, CODE_SIGNING.md, SignPath notes.

## Track 2: security
New shared network layer (`backend/src/net/safeNetwork.js`) used by HTTP, SMTP, Postgres, LLM and agent tools; execution limits (`backend/src/engine/limits.js`) wired into the engine and Loop node; Postgres port bound to loopback in docker-compose.

## Track 3: terms
Terms of Service rewritten (fair use, AI misuse, no resale, indemnification, governing-law placeholders, plan-change notice); PRIVACY.md AI section.

## Track 4: AI
`backend/src/ai/` (providers, agent loop, schema validator, calculator), `backend/src/nodes/ai.js` (`llmChain`, `aiAgent`), `aiProviderKey` credential type, frontend registry/panel/"AI" category, tier config, mock LLM server, docs/AI_NODES.md and docs/AI_GAP_ANALYSIS.md. Not built: memory, pgvector/RAG, MCP, chat trigger, templates, trace UI.

## Track 5: release
New release.yml (manual dispatch, tests first, date/build naming, checksum, optional signing); installer script and .iss fixes.

## Tests added
safeNetwork.test.js (12), limits.test.js (7), ai.test.js (20); registry test updated.

## Round 2: memory, RAG, legal fill-in, dependency check (this session)
- New: `backend/src/ai/memory.js` (Postgres-backed chat memory, per-user-scoped), `backend/src/ai/vectorStore.js` (Postgres-backed vector store using a plain array column, not pgvector), `backend/src/ai/textSplitter.js` (recursive character splitter).
- New node handlers in `backend/src/nodes/ai.js`: `splitText`, `embedText`, `vectorUpsert`, `vectorSearch`, `ragAnswer`. `llmChain`/`aiAgent` gained optional `memorySessionId`/`memoryMaxMessages` config.
- Schema: two new additive, idempotent tables (`ai_chat_memory`, `ai_vector_documents`) in `backend/src/db/index.js`.
- Engine: `ctx.userId`/`ctx.workspaceId` now exposed to node handlers for tenant-scoped storage.
- Frontend: 5 new node types registered with config panel UI; "Memory" fields added to the existing AI Agent/LLM Chain panel.
- Tests: `backend/src/test/rag.test.js` (splitter, cosine similarity, embedText validation run without a DB; memory/vector-store round-trip tests gated on `DATABASE_URL`, same pattern as `queue.test.js`).
- Tier config: `aiTiers.config.js` updated to place the new nodes across starter/pro.
- Fixed a regression I introduced and caught before shipping: memory/vectorStore initially required `DATABASE_URL` just to *import* the node registry (breaking DB-free tests); fixed with lazy imports.
- Legal: filled every remaining `[bracket]` placeholder in LICENSE.md, LICENSE_EE.md, COMMERCIAL-LICENSING.md, and the Terms of Service; fixed a fabricated email address; strengthened data-use commitments (no selling/training/sharing customer content) without falsely claiming zero data collection. Full reasoning and confirmation checklist in LEGAL_REVIEW_NEEDED.md.
- Declined: react-router v6→v7 migration (explained in DECISIONS.md — can't verify browser navigation in this sandbox).
- Docs: docs/AI_NODES.md and docs/AI_GAP_ANALYSIS.md updated for memory/RAG.

## Round 3: installer bug fix, installer UX, logo (this session)
- Fixed the real cause of "backend container unhealthy" on self-hosted installs: `.gitattributes` now forces LF line endings on shell scripts/Dockerfiles/compose files regardless of committer/CI OS, preventing Windows checkouts from corrupting `backend/docker-entrypoint.sh`'s shebang line.
- Installer now runs hidden (`-WindowStyle Hidden` on all shortcuts) with a small WPF "please wait" progress dialog during setup, instead of a raw scrolling console. Untested in this sandbox (no Windows/PowerShell runtime available) — needs a real run to confirm.
- Replaced the app logo (`frontend/public/logo.png`) with the user-provided logo; added a proper multi-resolution `.ico` and wired it into the installer (Setup.exe icon, uninstall icon, all shortcut icons).
