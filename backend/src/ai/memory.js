// Postgres-backed chat memory. Scoped by (user_id, session_id) so two different tenants using
// the same session-id string (e.g. both typing "test") can never see each other's history — the
// scoping key always includes ctx.userId, which node handlers cannot forge (it comes from the
// execution engine, not from workflow config).
import { v4 as uuid } from "uuid";

// db is imported lazily inside each function (not at module top level): this file is imported
// transitively by every node handler via src/nodes/ai.js -> src/nodes/index.js. A top-level
// import would make db/index.js's DATABASE_URL check run just from importing the node registry
// at all -- breaking tests like safeNetwork/ssrf that intentionally run with no database
// configured. Importing it lazily means the requirement only applies when this code actually runs.

const MAX_SESSION_ID_LEN = 200;

function assertUsable(userId, sessionId) {
  if (!userId) throw new Error("Chat memory requires an authenticated execution context (no userId available)");
  const s = String(sessionId ?? "").trim();
  if (!s) throw new Error("A session id is required to use memory (e.g. {{input.chatId}} or a fixed string per conversation)");
  if (s.length > MAX_SESSION_ID_LEN) throw new Error(`Session id must be at most ${MAX_SESSION_ID_LEN} characters`);
  return s;
}

/** Load the most recent `limit` turns for this session, oldest first (ready to feed to a model). */
export async function loadMemory({ userId, workspaceId, sessionId, limit = 20 }) {
  const { default: db } = await import("../db/index.js");
  const session = assertUsable(userId, sessionId);
  const max = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const rows = await db.prepare(
    "SELECT role, content FROM ai_chat_memory WHERE user_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(userId, session, max);
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

/** Append one turn and trim the session back down to `limit` rows so memory can't grow forever. */
export async function appendMemory({ userId, workspaceId, sessionId, role, content, limit = 20 }) {
  const { default: db } = await import("../db/index.js");
  const session = assertUsable(userId, sessionId);
  if (!["user", "assistant", "system"].includes(role)) throw new Error(`Invalid memory role "${role}"`);
  const max = Math.min(Math.max(Number(limit) || 20, 1), 200);
  await db.prepare(
    "INSERT INTO ai_chat_memory (id, user_id, workspace_id, session_id, role, content) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(uuid(), userId, workspaceId || null, session, role, String(content ?? ""));
  // Trim oldest rows beyond the retention limit for this session.
  await db.prepare(`
    DELETE FROM ai_chat_memory WHERE id IN (
      SELECT id FROM ai_chat_memory WHERE user_id = ? AND session_id = ?
      ORDER BY created_at DESC OFFSET ?
    )
  `).run(userId, session, max);
}

/** Delete an entire session's history (e.g. a "clear chat" action). */
export async function clearMemory({ userId, sessionId }) {
  const { default: db } = await import("../db/index.js");
  const session = assertUsable(userId, sessionId);
  await db.prepare("DELETE FROM ai_chat_memory WHERE user_id = ? AND session_id = ?").run(userId, session);
}
