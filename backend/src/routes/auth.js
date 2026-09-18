import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { v4 as uuid } from "uuid";
import db from "../db/index.js";
import { signToken, requireAuth } from "../auth.js";
import { sendTransactionalEmail, getMailerMode } from "../mailer.js";
import { recordAudit } from "../audit.js";
import { verifyGoogleIdToken } from "../googleIdentity.js";
import { resolveOrCreateGoogleUser } from "../googleAccount.js";

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_URL = process.env.APP_URL || "http://localhost:5173";

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

// Tokens are generated with high entropy, then only their SHA-256 hash is
// stored — identical reasoning to why we hash passwords. If the database
// were ever read by an attacker, they'd get hashes, not usable tokens.
function generateToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// 6-digit numeric code — same hashing principle as the link tokens above:
// only the hash is ever stored, so a database read alone can't produce a
// usable code. crypto.randomInt is cryptographically strong, unlike Math.random.
function generateOtp() {
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  return { code, hash: hashValue(code) };
}

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds between resends

async function issueAndSendOtp(user) {
  const { code, hash } = generateOtp();
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  // Overwriting the hash here is what invalidates any previously-issued
  // code — there's only ever one valid hash stored per user at a time.
  await db.prepare(
    "UPDATE users SET verification_token_hash = ?, verification_otp_expires = ?, verification_otp_last_sent = ? WHERE id = ?"
  ).run(hash, expires, new Date().toISOString(), user.id);

  return sendTransactionalEmail({
    to: user.email,
    subject: "Your iii3xnz verification code",
    text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore this email.`,
  }).catch((err) => {
    // Previously this error vanished silently — a bad SMTP password, wrong
    // host, etc. produced no OTP and no visible error anywhere. Now it's
    // impossible to miss in the terminal, and the caller decides what to do.
    console.error("\n[EMAIL SEND FAILED]", err.message, "\n");
    throw err;
  });
}

router.post("/signup", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address" });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: "Password must be 8-200 characters" });
  }
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const id = uuid();
  const passwordHash = bcrypt.hashSync(password, 10);

  // No email provider configured (dev/self-host mode without SMTP or Brevo
  // set up) — there's no way to actually deliver an OTP, so requiring
  // verification would just lock people out. Auto-verify instead, matching
  // how other self-hosted tools (e.g. n8n) treat email verification as
  // optional unless the operator has configured real email sending.
  const skipVerification = getMailerMode() === "dev";

  await db.prepare(
    "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, ?)"
  ).run(id, email, passwordHash, skipVerification ? 1 : 0);

  let emailError = null;
  if (!skipVerification) {
    try {
      await issueAndSendOtp({ id, email });
    } catch (err) {
      // Don't fail signup over an email problem — the account is created
      // either way, and the user can retry sending the code from the app
      // once SMTP is fixed. But do tell the client it didn't go out.
      emailError = "Your account was created, but the verification email could not be sent. Check your SMTP configuration and use 'Resend code'.";
    }
  }

  const rememberMe = req.body?.rememberMe === true;
  const user = { id, email, plan: "free" };
  res.json({ token: signToken(user, { rememberMe }), user, emailError, emailVerified: skipVerification });
});

router.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;
  const rememberMe = req.body?.rememberMe === true;
  if (!email || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password required" });
  }
  const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  // Same generic error whether the email doesn't exist or the password is
  // wrong — never reveal which one it was, that leaks which emails are registered.
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  res.json({
    token: signToken(user, { rememberMe }),
    user: { id: user.id, email: user.email, plan: user.plan },
  });
  await recordAudit(user.id, "login", "account");
});

router.post("/google", async (req, res) => {
  try {
    const identity = await verifyGoogleIdToken(req.body?.credential);
    const result = await resolveOrCreateGoogleUser(db, identity, { allowCreate: req.body?.acceptedLegal === true });
    if (result.conflict) {
      return res.status(409).json({ error: "An account with this email already exists. Log in with your password before linking Google." });
    }
    if (result.legalRequired) {
      return res.status(400).json({ error: "Please accept the Terms of Service and Privacy Policy before creating an account." });
    }
    const user = result.user;
    const rememberMe = req.body?.rememberMe === true;
    await recordAudit(user.id, result.created ? "signup.google" : "login.google", "account");
    return res.status(result.created ? 201 : 200).json({ token: signToken(user, { rememberMe }), user: { id: user.id, email: user.email, plan: user.plan } });
  } catch (err) {
    return res.status(401).json({ error: err.message || "Google authentication failed" });
  }
});

router.post("/google/link", requireAuth, async (req, res) => {
  try {
    const identity = await verifyGoogleIdToken(req.body?.credential);
    const user = await db.prepare("SELECT id, email FROM users WHERE id = ?").get(req.user.id);
    if (!user || user.email !== identity.email) return res.status(409).json({ error: "Google email must match the signed-in account before linking" });
    const existing = await db.prepare("SELECT user_id FROM auth_identities WHERE provider = ? AND provider_subject = ?").get("google", identity.subject);
    if (existing && existing.user_id !== user.id) return res.status(409).json({ error: "This Google account is linked to another iii3xnz account" });
    await db.prepare("INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES (?, ?, ?, ?) ON CONFLICT (provider, provider_subject) DO NOTHING").run(uuid(), user.id, "google", identity.subject);
    res.json({ ok: true });
  } catch (err) {
    res.status(401).json({ error: err.message || "Google linking failed" });
  }
});

// Fresh account state, independent of what the JWT claims — a JWT issued
// before verification would otherwise report stale emailVerified: false forever.
router.get("/me", requireAuth, async (req, res) => {
  const user = await db
    .prepare("SELECT id, email, plan, email_verified, avatar_url FROM users WHERE id = ?")
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  res.json({ id: user.id, email: user.email, plan: user.plan, emailVerified: !!user.email_verified, avatarUrl: user.avatar_url });
});

const MAX_AVATAR_BYTES = 300_000; // ~300KB — plenty for a small profile photo, keeps the DB row lean

router.patch("/profile", requireAuth, async (req, res) => {
  const { avatarUrl } = req.body;
  if (avatarUrl !== undefined) {
    if (avatarUrl !== null && (typeof avatarUrl !== "string" || avatarUrl.length > MAX_AVATAR_BYTES)) {
      return res.status(400).json({ error: `Image is too large (max ~${Math.round(MAX_AVATAR_BYTES / 1000)}KB)` });
    }
    await db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(avatarUrl, req.user.id);
  }
  res.json({ ok: true });
});

router.post("/verify-otp", requireAuth, async (req, res) => {
  const { otp } = req.body;
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: "Enter the 6-digit code" });
  }

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });

  if (!user.verification_token_hash || !user.verification_otp_expires) {
    return res.status(400).json({ error: "No code was requested — click resend to get a new one" });
  }
  if (new Date(user.verification_otp_expires) < new Date()) {
    return res.status(400).json({ error: "This code has expired — click resend to get a new one" });
  }
  if (hashValue(otp) !== user.verification_token_hash) {
    return res.status(400).json({ error: "Incorrect code" });
  }

  await db.prepare(
    "UPDATE users SET email_verified = 1, verification_token_hash = NULL, verification_otp_expires = NULL WHERE id = ?"
  ).run(user.id);
  res.json({ ok: true });
});

router.post("/resend-otp", requireAuth, async (req, res) => {
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });

  if (user.verification_otp_last_sent) {
    const elapsed = Date.now() - new Date(user.verification_otp_last_sent).getTime();
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
      return res.status(429).json({ error: `Please wait ${waitSeconds}s before requesting another code` });
    }
  }

  try {
    await issueAndSendOtp(user); // overwrites the previous code's hash, invalidating it immediately
  } catch (err) {
    return res.status(500).json({ error: "Failed to send email — check the server's SMTP configuration" });
  }
  res.json({ ok: true });
});

router.post("/forgot-password", async (req, res) => {
  if (getMailerMode() === "dev") {
    return res.status(400).json({
      error: "Password reset requires an email provider to be configured. See docs/SELF_HOSTING.md for setup instructions (Brevo or SMTP).",
    });
  }

  const email = normalizeEmail(req.body.email);
  const user = email ? await db.prepare("SELECT * FROM users WHERE email = ?").get(email) : null;

  // Always the same response whether or not the account exists — otherwise
  // this endpoint becomes a way to check which emails are registered.
  if (user) {
    const { raw: resetToken, hash: resetHash } = generateToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    await db.prepare(
      "UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?"
    ).run(resetHash, expires, user.id);
    try {
      await sendTransactionalEmail({
        to: user.email,
        subject: "Reset your iii3xnz password",
        text: `Reset your password (expires in 1 hour): ${APP_URL}/reset-password?token=${resetToken}\n\nIf you didn't request this, you can ignore this email.`,
      });
    } catch (err) {
      console.error("\n[EMAIL SEND FAILED]", err.message, "\n");
      // Still return the generic success message below — don't reveal
      // send failures to the client, that's the same enumeration risk as
      // revealing account existence. The error is visible in the server log instead.
    }
  }
  res.json({ ok: true, message: "If an account with that email exists, a reset link has been sent." });
});

router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (typeof token !== "string" || !token) return res.status(400).json({ error: "Missing token" });
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 200) {
    return res.status(400).json({ error: "Password must be 8-200 characters" });
  }

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await db.prepare("SELECT * FROM users WHERE reset_token_hash = ?").get(hash);
  if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: "Invalid or expired reset link" });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await db.prepare(
    "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?"
  ).run(passwordHash, user.id);
  res.json({ ok: true });
});

export default router;