/**
 * PostgreSQL migrations for open-sandboxes cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: projects
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: agents
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    last_seen_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)`,

  // Migration 3: sandboxes
  `CREATE TABLE IF NOT EXISTS sandboxes (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(provider IN ('e2b', 'daytona', 'modal')),
    provider_sandbox_id TEXT,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating', 'running', 'paused', 'stopped', 'deleted', 'error')),
    image TEXT,
    timeout INTEGER DEFAULT 3600,
    config TEXT DEFAULT '{}',
    env_vars TEXT DEFAULT '{}',
    keep_alive_until TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sandboxes_provider ON sandboxes(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_sandboxes_project ON sandboxes(project_id)`,

  // Migration 4: sandbox_sessions
  `CREATE TABLE IF NOT EXISTS sandbox_sessions (
    id TEXT PRIMARY KEY,
    sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
    agent_name TEXT,
    agent_type TEXT,
    command TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'killed')),
    exit_code INTEGER,
    started_at TEXT NOT NULL DEFAULT NOW()::text,
    ended_at TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_sandbox ON sandbox_sessions(sandbox_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_status ON sandbox_sessions(status)`,

  // Migration 5: sandbox_events
  `CREATE TABLE IF NOT EXISTS sandbox_events (
    id TEXT PRIMARY KEY,
    sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES sandbox_sessions(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('stdout', 'stderr', 'lifecycle', 'agent')),
    data TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_events_sandbox ON sandbox_events(sandbox_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_session ON sandbox_events(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_type ON sandbox_events(type)`,

  // Migration 6: webhooks
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 7: _migrations tracking
  `CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 8: sandbox pause/resume columns + templates table
  `ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS on_timeout TEXT NOT NULL DEFAULT 'terminate' CHECK(on_timeout IN ('pause', 'terminate'))`,
  `ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS auto_resume BOOLEAN NOT NULL DEFAULT FALSE`,

  `CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    image TEXT,
    env_vars TEXT NOT NULL DEFAULT '{}',
    setup_script TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name)`,

  // Migration 9: snapshots table
  `CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    sandbox_id TEXT NOT NULL,
    provider_sandbox_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_snapshots_sandbox ON snapshots(sandbox_id)`,

  // Migration 10: budget tracking and started_at
  `ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS budget_limit_usd REAL`,
  `ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS on_budget_exceeded TEXT NOT NULL DEFAULT 'terminate' CHECK(on_budget_exceeded IN ('terminate', 'pause', 'notify'))`,
  `ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS started_at TEXT`,

  // Migration 11: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 12: agent focus
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS active_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`,
];
