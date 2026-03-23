import { SqliteAdapter as Database } from "@hasna/cloud";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function findNearestDb(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".sandboxes", "sandboxes.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getDbPath(): string {
  // Support env var overrides
  const envPath = process.env["HASNA_SANDBOXES_DB_PATH"] ?? process.env["SANDBOXES_DB_PATH"];
  if (envPath) return envPath;

  // Check for project-local .sandboxes/ directory
  const cwd = process.cwd();
  const nearest = findNearestDb(cwd);
  if (nearest) return nearest;

  // Global: ~/.hasna/sandboxes/ (with backward compat from ~/.sandboxes/)
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  const newDir = join(home, ".hasna", "sandboxes");
  const oldDir = join(home, ".sandboxes");

  // Auto-migrate from old location if new dir doesn't exist yet
  if (!existsSync(newDir) && existsSync(oldDir)) {
    try {
      mkdirSync(join(home, ".hasna"), { recursive: true });
      cpSync(oldDir, newDir, { recursive: true });
    } catch {
      // Fall through
    }
  }

  return join(newDir, "sandboxes.db");
}

function ensureDir(filePath: string): void {
  if (isInMemoryDb(filePath)) return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const MIGRATIONS = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

  CREATE TABLE IF NOT EXISTS sandboxes (
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);
  CREATE INDEX IF NOT EXISTS idx_sandboxes_provider ON sandboxes(provider);
  CREATE INDEX IF NOT EXISTS idx_sandboxes_project ON sandboxes(project_id);

  CREATE TABLE IF NOT EXISTS sandbox_sessions (
    id TEXT PRIMARY KEY,
    sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
    agent_name TEXT,
    agent_type TEXT CHECK(agent_type IN ('claude', 'codex', 'gemini', 'custom')),
    command TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'killed')),
    exit_code INTEGER,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_sandbox ON sandbox_sessions(sandbox_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sandbox_sessions(status);

  CREATE TABLE IF NOT EXISTS sandbox_events (
    id TEXT PRIMARY KEY,
    sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES sandbox_sessions(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('stdout', 'stderr', 'lifecycle', 'agent')),
    data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_events_sandbox ON sandbox_events(sandbox_id);
  CREATE INDEX IF NOT EXISTS idx_events_session ON sandbox_events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON sandbox_events(type);

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO _migrations (id) VALUES (1);
  `,

  // Migration 2: Add templates table and sandbox pause/resume columns
  `
ALTER TABLE sandboxes ADD COLUMN on_timeout TEXT NOT NULL DEFAULT 'terminate' CHECK(on_timeout IN ('pause', 'terminate'));
ALTER TABLE sandboxes ADD COLUMN auto_resume INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  image TEXT,
  env_vars TEXT NOT NULL DEFAULT '{}',
  setup_script TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);

INSERT OR IGNORE INTO _migrations (id) VALUES (2);
  `,

  // Migration 3: Expand agent_type to support opencode and pi
  `
CREATE TABLE IF NOT EXISTS sandbox_sessions_new (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  agent_name TEXT,
  agent_type TEXT,
  command TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'killed')),
  exit_code INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
INSERT INTO sandbox_sessions_new SELECT * FROM sandbox_sessions;
DROP TABLE sandbox_sessions;
ALTER TABLE sandbox_sessions_new RENAME TO sandbox_sessions;
CREATE INDEX IF NOT EXISTS idx_sessions_sandbox ON sandbox_sessions(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sandbox_sessions(status);
INSERT OR IGNORE INTO _migrations (id) VALUES (3);
  `,

  // Migration 4: Add snapshots table for filesystem snapshot/restore
  `
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  provider_sandbox_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_sandbox ON snapshots(sandbox_id);
INSERT OR IGNORE INTO _migrations (id) VALUES (4);
  `,

  // Migration 5: Add budget tracking and started_at to sandboxes
  `
ALTER TABLE sandboxes ADD COLUMN budget_limit_usd REAL;
ALTER TABLE sandboxes ADD COLUMN on_budget_exceeded TEXT NOT NULL DEFAULT 'terminate' CHECK(on_budget_exceeded IN ('terminate', 'pause', 'notify'));
ALTER TABLE sandboxes ADD COLUMN started_at TEXT;
INSERT OR IGNORE INTO _migrations (id) VALUES (5);
  `,

  // Migration 6: Add feedback table
  `
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), message TEXT NOT NULL, email TEXT, category TEXT DEFAULT 'general', version TEXT, machine_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
INSERT OR IGNORE INTO _migrations (id) VALUES (6);
  `,

  // Migration 7: Agent focus
  `
ALTER TABLE agents ADD COLUMN active_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
INSERT OR IGNORE INTO _migrations (id) VALUES (7);
  `,
];

let db: Database | null = null;

function runMigrations(database: Database): void {
  database.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");

  const applied = new Set(
    database
      .query("SELECT id FROM _migrations")
      .all()
      .map((r) => (r as { id: number }).id)
  );

  for (let i = 0; i < MIGRATIONS.length; i++) {
    const migrationId = i + 1;
    if (!applied.has(migrationId)) {
      database.exec(MIGRATIONS[i]!);
    }
  }
}

export function getDatabase(): Database {
  if (db) return db;

  const dbPath = getDbPath();
  ensureDir(dbPath);

  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function uuid(): string {
  return randomUUID();
}

export function shortId(): string {
  return uuid().slice(0, 8);
}

export function now(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

export function resolvePartialId(
  table: string,
  partialId: string
): string | null {
  const database = getDatabase();
  const rows = database
    .query(`SELECT id FROM ${table} WHERE id LIKE ? || '%'`)
    .all(partialId) as { id: string }[];

  if (rows.length === 1) return rows[0]!.id;
  if (rows.length === 0) return null;

  // Exact match takes priority
  const exact = rows.find((r) => r.id === partialId);
  if (exact) return exact.id;

  return null; // Ambiguous
}
