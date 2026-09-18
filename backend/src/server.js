import "dotenv/config"; // loads .env into process.env — must be the first import so every module below sees the values
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.js";
import workflowRoutes from "./routes/workflows.js";
import webhookRoutes from "./routes/webhooks.js";
import billingRoutes from "./routes/billing.js";
import dodoWebhookRoutes from "./routes/dodoWebhook.js";
import workspaceRoutes from "./routes/workspaces.js";
import internalRoutes from "./routes/internal.js";
import credentialsRoutes from "./routes/credentials.js";
import oauthRoutes from "./routes/oauth.js";
import executionRoutes from "./routes/executions.js";
import { syncSchedules } from "./engine/scheduler.js";
import { logMailerModeOnStartup } from "./mailer.js";
import db from "./db/index.js";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Set it before starting the backend.");
if (!process.env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required. Set it before starting the backend.");

if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY || "")) {
  throw new Error("ENCRYPTION_KEY must be a 64-character hexadecimal value.");
}
const app = express();
app.set("trust proxy", 1); // needed for correct client IPs behind nginx/a reverse proxy, so rate limiting works right
app.use(helmet());

// In production, only your own frontend origin may call the API.
// In dev (no APP_URL set) this falls back to allowing localhost's Vite dev server.
const allowedOrigin = process.env.APP_URL || "http://localhost:5173";
app.use(cors({ origin: allowedOrigin, credentials: true }));

// Dodo's webhook signature covers the exact raw request bytes.
if (process.env.SELF_HOSTED !== "true") {
  app.use("/api/dodo-webhook", express.raw({ type: "application/json" }), dodoWebhookRoutes);
}

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Auth endpoints are the classic brute-force target — cap attempts per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 100 : 20,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);

// Public webhook triggers can be hammered by anyone who finds/guesses a path.
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use("/webhook", webhookLimiter);

app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/readiness", async (req, res) => {
  try {
    await db.pool.query("SELECT 1");
    res.json({ ok: true, database: "ok" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/credentials", credentialsRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/executions", executionRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/webhook", webhookRoutes);
app.use("/internal", internalRoutes);

// Centralized error handler: never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error" });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, async () => {
  console.log(`iii3xnz backend listening on port ${PORT}`);
  logMailerModeOnStartup();
  await syncSchedules();
});

async function shutdown(signal) {
  console.log(`iii3xnz shutting down (${signal})`);
  const { stopSchedules } = await import("./engine/scheduler.js");
  stopSchedules();
  await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));