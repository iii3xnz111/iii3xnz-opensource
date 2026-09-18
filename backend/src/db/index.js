import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Example: postgres://user:password@localhost:5432/flowforge " +
    "(add ?sslmode=require for managed providers like Render/Railway/Supabase)."
  );
}

// Encryption in transit: when a managed provider's connection string asks
// for SSL, node-postgres needs an explicit ssl option to actually use it —
// it won't infer this from the connection string alone. rejectUnauthorized
// is false because most managed providers (Render, Railway, Supabase) use
// certificates that aren't in Node's default trust store; the connection is
// still encrypted, this only skips validating the cert chain.
//
// NOTE on encryption AT rest: that's a property of the disk the database
// lives on, not something an application can add after the fact — every
// mainstream managed Postgres provider (Render, Railway, Supabase, RDS)
// encrypts storage volumes at rest by default. What this app DOES add on
// top is column-level encryption for the most sensitive table regardless of
// host (see credentials.encrypted_data) — that protects against a raw
// database dump/leak even while the database is live, which disk-level
// encryption alone does not.
const useSSL = /sslmode=require/i.test(process.env.DATABASE_URL) || process.env.PGSSLMODE === "require";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX) || 10,
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 5000,
  allowExitOnIdle: true,
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres pool error:", err.message);
});

function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function prepare(sql) {
  const converted = toPositional(sql);
  return {
    async get(...params) {
      const res = await pool.query(converted, params);
      return res.rows[0];
    },
    async all(...params) {
      const res = await pool.query(converted, params);
      return res.rows;
    },
    async run(...params) {
      const res = await pool.query(converted, params);
      return { changes: res.rowCount };
    },
  };
}

async function exec(sql) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["iii3xnz:schema"]);
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback({
      query: (sql, params = []) => client.query(toPositional(sql), params),
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runMigration(id, sql) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["iii3xnz:schema"]);
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
    if (!applied.rowCount) {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      dodo_customer_id TEXT UNIQUE,
      dodo_subscription_id TEXT,
      dodo_subscription_event_at TIMESTAMPTZ,
      subscription_status TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token_hash TEXT,
      reset_token_hash TEXT,
      reset_token_expires TEXT,
      verification_otp_expires TEXT,
      verification_otp_last_sent TEXT,
      avatar_url TEXT,
      default_workspace_id TEXT,
      created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_subject),
      UNIQUE (user_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities (user_id);

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects (workspace_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_invites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      workspace_id TEXT REFERENCES workspaces(id),
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      webhook_path TEXT UNIQUE,
      error_workflow_id TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT NOW(),
      updated_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),
      workspace_id TEXT REFERENCES workspaces(id),
      status TEXT NOT NULL,
      log TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT NOW(),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS workflow_versions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workflow_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_created ON workflow_versions (workflow_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS workflow_permissions (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, workflow_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_permissions_user ON workflow_permissions (user_id, workflow_id);

    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      id TEXT PRIMARY KEY,
      state_hash TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      code_verifier_encrypted TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states (expires_at);

    CREATE TABLE IF NOT EXISTS oauth_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT,
      account_label TEXT,
      scopes TEXT NOT NULL DEFAULT '[]',
      encrypted_tokens TEXT NOT NULL,
      access_token_expires_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'connected',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, workspace_id, provider, provider_account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_connections_owner ON oauth_connections (user_id, workspace_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id),
      user_id TEXT NOT NULL,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      trigger_payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      quota_reserved INTEGER NOT NULL DEFAULT 0,
      dedupe_key TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at);

    CREATE TABLE IF NOT EXISTS quota_reservations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_quota_reservations_scope ON quota_reservations (user_id, workspace_id, created_at);

    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      provider_event_id TEXT UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER,
      currency TEXT,
      description TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_billing_events_user_occurred ON billing_events (user_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs (user_id, created_at DESC);
  `);

  await exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await runMigration("001_workspace_and_execution_fields", `
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_otp_expires TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_otp_last_sent TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE workflows ADD COLUMN IF NOT EXISTS error_workflow_id TEXT;
    ALTER TABLE workflows ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
    ALTER TABLE credentials ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS dodo_customer_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS dodo_subscription_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS dodo_subscription_event_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS default_workspace_id TEXT;
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
    ALTER TABLE workflows ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quota_reserved INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS execution_id TEXT;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
    ALTER TABLE executions ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
    ALTER TABLE executions ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id);
    UPDATE credentials c SET workspace_id = u.default_workspace_id FROM users u WHERE c.user_id = u.id AND c.workspace_id IS NULL AND u.default_workspace_id IS NOT NULL;
    UPDATE executions e SET user_id = w.user_id, workspace_id = w.workspace_id FROM workflows w WHERE e.workflow_id = w.id AND (e.user_id IS NULL OR e.workspace_id IS NULL);
    ALTER TABLE executions DROP CONSTRAINT IF EXISTS executions_workflow_id_fkey;
    CREATE INDEX IF NOT EXISTS idx_executions_owner_started ON executions (user_id, workspace_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_execution ON jobs (execution_id);
    CREATE TABLE IF NOT EXISTS merge_states (
      execution_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      merge_node_id TEXT NOT NULL,
      required_sources TEXT NOT NULL,
      completed_sources TEXT NOT NULL DEFAULT '[]',
      outputs TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'waiting',
      expires_at TIMESTAMPTZ NOT NULL,
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (execution_id, merge_node_id)
    );
    ALTER TABLE merge_states ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_merge_states_expiry ON merge_states (expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe_key ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs (status, next_attempt_at, created_at);
  `);
}

await initSchema();

const db = { prepare, exec, pool, transaction };
export default db;
