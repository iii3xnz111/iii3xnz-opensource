# Verification report (INCOMPLETE: the mandatory gate could not be fully run)

Date: 2026-09-28. Sandbox: Node 22.22.2, no internet for shell tools, no Docker, no PostgreSQL, no PowerShell, no actionlint.

## Ran and passed
- Offline-capable suites (safeNetwork, limits, ai, ssrf, engine, plan, integrations, registry), command: `JWT_SECRET=x NODE_ENV=test node --test <files>`
```
# tests 70
# pass 70
# fail 0
# skipped 0
```
- YAML parse of release.yml: release.yml parses as YAML
- Offline license audit of installed node_modules: only MIT, ISC, BSD, Apache-2.0, BlueOak, MIT-0, CC-BY-4.0; no GPL/AGPL/SSPL/unknown.
- Secret scan (sk-, AKIA, private key headers, ghp_) and `.env` search: no hits.
- Both plan modes checked directly: cloud mode gates `aiAgent` for free plan; SELF_HOSTED=true returns no restriction.

## Ran with failures (all environmental)
Full suite, command: `env -u DATABASE_URL JWT_SECRET=x NODE_ENV=test npm test`
```
# tests 135
# pass 100
# fail 20
# skipped 15
```
The 20 failures all throw "DATABASE_URL is not set"; 15 tests are skipped by their own DATABASE_URL guard. They were NOT run against a real database, so the README's known OTP failure was not reproduced or fixed.

## Could not run
1. `npm ci` for backend/frontend (no registry access).
2. Frontend `npm run build`: fails here because the shipped node_modules contain Windows-only rollup binaries (`@rollup/rollup-linux-x64-gnu` missing). Not a code error, but unproven. The new frontend code (registry entries, config panel block, Terms page) was never compiled.
3. Tests against PostgreSQL / pgvector; Docker Compose start; end-to-end smoke test (register, workflow run, AI workflow, limits) through the HTTP API.
4. `npm audit`.
5. actionlint, PowerShell and Inno Setup static analysis, and the Windows installer build. The installer/.iss/release.yml changes were checked by reading only.
6. SignPath signing.
7. Any real LLM provider or Ollama: adapters were tested only against the in-repo mock server.

## Not built
Memory, pgvector/RAG nodes, MCP, chat trigger, AI templates, agent-trace UI, concurrency and webhook payload caps, streaming.

## Round 2 addendum: memory, RAG, legal fill-in (this session)

Same sandbox limits as before (no internet for npm/Docker, no PostgreSQL, no Windows). What changed:

### Ran and passed
- Full backend suite, `DATABASE_URL` unset: 146 tests (was 135 — added 11 in `rag.test.js`), 105 pass, 20 fail, 21 skipped. The 20 failures are the exact same pre-existing `api.test.js` set as every prior run in this sandbox (needs a live server + DB, no skip guard) — confirmed by diffing the failing-test names against the previous report. No new failures.
- `rag.test.js` in isolation: 5 pure-function tests pass (`splitText` chunking/overlap/empty-input, `embedText` validation, `cosineSimilarity` ranking and dimension-mismatch rejection) with no database. 6 database-backed tests (memory round-trip and cross-tenant isolation, vector store round-trip and cross-tenant isolation, `ragAnswer` citing sources, `ragAnswer` with no matches) skip cleanly, same pattern as `queue.test.js`.
- `registry.test.js`: still passes after adding 5 new node types (each has both a frontend config panel entry and a backend handler).
- Regression check specific to this round: caught, during development, that importing `nodes/ai.js` had started requiring `DATABASE_URL` just to load the node registry at all (via an eager `db` import in the new memory/vectorStore modules) — this would have broken `safeNetwork.test.js`/`ssrf.test.js`, which intentionally run with no database configured. Fixed with lazy imports; re-verified both files still pass with `DATABASE_URL` unset.
- Frontend files touched this round (`NodeConfigPanel.jsx`, `nodeRegistry.js`, `LegalPage.jsx`) parse without syntax errors, checked with `@babel/parser` directly (the full `vite build` still can't run in this sandbox — see the original report's frontend-build note, unchanged and unrelated to this round's edits).
- Swept every file for leftover `[bracket]` placeholders after filling them: none remain outside `LEGAL_REVIEW_NEEDED.md` itself (where they're listed for review, not left unfilled in the actual legal text).

### Could not run (unchanged from before, plus one new item)
- Everything listed as "could not run" in the original report still applies (`npm ci`, `npm run build`, Docker, a real Postgres, `npm audit`, Windows/installer/SignPath tooling) — **except** the user has since run all of those successfully on their own machine, with real results already reported back and acted on in this conversation (135/135 backend tests, clean frontend build, a real GitHub Actions release run). That verification predates this round's memory/RAG/legal changes and does not cover them yet.
- **New in this round, not yet verified anywhere:** the 6 database-backed tests in `rag.test.js` (memory and vector-store behavior against a real Postgres) have never been run — not in this sandbox (no database) and not yet on the user's machine (this round's zip hasn't been tested there yet). This is the main next step.
- The new AI nodes were never tried against a real LLM provider or a real Ollama instance, same limitation as the original AI nodes.

### Not built this round
MCP client, classifier/extractor/summarizer nodes, Chat Trigger + test chat, AI templates, agent-trace UI, streaming, pgvector-backed indexing (deliberately not used at all — see docs/AI_NODES.md).
