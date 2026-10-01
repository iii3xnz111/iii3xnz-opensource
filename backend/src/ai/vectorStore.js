// Postgres-backed vector store. Embeddings are stored as a plain double precision[] column
// (see src/db/index.js for why this doesn't use the pgvector extension) and similarity is
// computed in application code. This is simple, dependency-free and portable, at the cost of
// scanning every row in a collection on each search — documented as a few-thousand-document
// ceiling in docs/AI_NODES.md. Every row is scoped by user_id; a workflow can only ever search
// or delete its own tenant's documents, regardless of what "collection" name it supplies.
import { v4 as uuid } from "uuid";

// db is imported lazily inside each function (not at module top level): this file is imported
// transitively by every node handler via src/nodes/ai.js -> src/nodes/index.js. A top-level
// import would make db/index.js's DATABASE_URL check run just from importing the node registry
// at all -- breaking tests like safeNetwork/ssrf that intentionally run with no database
// configured. Importing it lazily means the requirement only applies when this code actually runs.

const MAX_COLLECTION_LEN = 200;
const MAX_CANDIDATE_ROWS = 5000; // safety cap so a search can't scan an unbounded table

function assertCollection(userId, collection) {
  if (!userId) throw new Error("The vector store requires an authenticated execution context (no userId available)");
  const c = String(collection ?? "").trim();
  if (!c) throw new Error("A collection name is required (e.g. \"support-docs\")");
  if (c.length > MAX_COLLECTION_LEN) throw new Error(`Collection name must be at most ${MAX_COLLECTION_LEN} characters`);
  return c;
}

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return -1; // different embedding model/dimension: never a match
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Insert one document with its embedding. metadata is stored as JSON (any small plain object). */
export async function upsertDocument({ userId, workspaceId, collection, content, embedding, metadata = {} }) {
  const { default: db } = await import("../db/index.js");
  const c = assertCollection(userId, collection);
  if (!Array.isArray(embedding) || !embedding.length || !embedding.every(Number.isFinite)) {
    throw new Error("embedding must be a non-empty array of numbers");
  }
  if (typeof content !== "string" || !content.trim()) throw new Error("content is required");
  let metaJson;
  try { metaJson = JSON.stringify(metadata ?? {}); } catch { throw new Error("metadata must be JSON-serializable"); }
  const id = uuid();
  await db.prepare(
    "INSERT INTO ai_vector_documents (id, user_id, workspace_id, collection, content, metadata, embedding, dimension) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, userId, workspaceId || null, c, content, metaJson, embedding, embedding.length);
  return { id };
}

/** Return the top `k` documents in `collection` most similar to `queryEmbedding`. */
export async function similaritySearch({ userId, collection, queryEmbedding, k = 4 }) {
  const { default: db } = await import("../db/index.js");
  const c = assertCollection(userId, collection);
  if (!Array.isArray(queryEmbedding) || !queryEmbedding.length) throw new Error("queryEmbedding must be a non-empty array of numbers");
  const topK = Math.min(Math.max(Number(k) || 4, 1), 50);
  const rows = await db.prepare(
    "SELECT id, content, metadata, embedding FROM ai_vector_documents WHERE user_id = ? AND collection = ? ORDER BY created_at DESC LIMIT ?"
  ).all(userId, c, MAX_CANDIDATE_ROWS);
  const scored = rows
    .map((r) => ({ id: r.id, content: r.content, metadata: JSON.parse(r.metadata || "{}"), score: cosineSimilarity(queryEmbedding, r.embedding) }))
    .filter((r) => r.score > -1) // drop dimension mismatches (a different embedding model was used)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored;
}

/** Delete every document in a collection for this tenant (e.g. re-indexing). */
export async function clearCollection({ userId, collection }) {
  const { default: db } = await import("../db/index.js");
  const c = assertCollection(userId, collection);
  const result = await db.prepare("DELETE FROM ai_vector_documents WHERE user_id = ? AND collection = ?").run(userId, c);
  return { deleted: result.changes };
}
