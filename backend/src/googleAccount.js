import { v4 as uuid } from "uuid";

export async function resolveOrCreateGoogleUser(db, identity, { allowCreate = true } = {}) {
  const linked = await db.prepare(
    "SELECT u.* FROM auth_identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.provider_subject = ?"
  ).get("google", identity.subject);
  if (linked) return { user: linked, created: false };

  const sameEmail = await db.prepare("SELECT id FROM users WHERE email = ?").get(identity.email);
  if (sameEmail) return { conflict: true };
  if (!allowCreate) return { legalRequired: true };

  const userId = uuid();
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, NULL, 1)", [userId, identity.email]);
    await tx.query("INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES (?, ?, ?, ?)", [uuid(), userId, "google", identity.subject]);
  });
  return { user: { id: userId, email: identity.email, plan: "free" }, created: true };
}
