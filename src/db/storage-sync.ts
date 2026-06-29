import { type Database } from "bun:sqlite";
import { getDatabase, getDbPath } from "./database.js";
import {
  STORAGE_DATABASE_ENV,
  getStorageConfig,
  getStorageConnectionString,
  getStorageDatabaseEnv,
  hasStorageConfigConnection,
  type StorageMode,
} from "./storage-config.js";
import { PgAdapterAsync } from "./remote-storage.js";
import { PG_MIGRATIONS } from "./pg-migrations.js";

type Row = Record<string, unknown>;

export interface SyncResult {
  table: string;
  direction: "push" | "pull";
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
}

export interface StorageStatus {
  configured: boolean;
  mode: StorageMode;
  enabled: boolean;
  env: typeof STORAGE_DATABASE_ENV;
  activeEnv: string | null;
  remote?: {
    checked: boolean;
    ok: boolean;
    error?: string;
  };
  service: "sandboxes";
  db_path: string;
  tables: Array<{ table: string; rows: number }>;
}

export const STORAGE_TABLES = [
  "projects",
  "agents",
  "sandboxes",
  "sandbox_sessions",
  "sandbox_events",
  "webhooks",
  "templates",
  "snapshots",
  "feedback",
] as const;

export const SANDBOXES_STORAGE_TABLES = STORAGE_TABLES;

const TABLE_KEYS: Record<string, string[]> = {
  projects: ["id"],
  agents: ["id"],
  sandboxes: ["id"],
  sandbox_sessions: ["id"],
  sandbox_events: ["id"],
  webhooks: ["id"],
  templates: ["id"],
  snapshots: ["id"],
  feedback: ["id"],
};

const IMMUTABLE_COLUMNS: Record<string, string[]> = {
  projects: ["id"],
  agents: ["id"],
  templates: ["id"],
};

const NATURAL_KEYS: Record<string, string[]> = {
  projects: ["path"],
  agents: ["name"],
  templates: ["name"],
};

const RECENCY_COLUMNS: Record<string, string> = {
  projects: "updated_at",
  agents: "last_seen_at",
  sandboxes: "updated_at",
  templates: "updated_at",
};

const BOOLEAN_COLUMNS: Record<string, string[]> = {
  sandboxes: ["auto_resume"],
  webhooks: ["active"],
};

function quoteId(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function toPgRow(table: string, row: Row): Row {
  const copy = { ...row };
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (column in copy) copy[column] = Boolean(copy[column]);
  }
  return copy;
}

function toSqliteRow(table: string, row: Row): Row {
  const copy = { ...row };
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (column in copy) copy[column] = copy[column] ? 1 : 0;
  }
  return copy;
}

async function getRemoteColumns(remote: PgAdapterAsync, table: string): Promise<Set<string>> {
  const rows = await remote.all(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    table
  ) as Array<{ column_name: string }>;
  return new Set(rows.map((row) => row.column_name));
}

function getSqliteColumns(db: Database, table: string): Set<string> {
  const rows = db.query(`PRAGMA table_info(${quoteId(table)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

async function assertNoPgNaturalKeyConflict(remote: PgAdapterAsync, table: string, row: Row): Promise<void> {
  const naturalKeys = NATURAL_KEYS[table];
  if (!naturalKeys || naturalKeys.some((column) => !row[column]) || !row.id) return;

  const clauses = naturalKeys.map((column, index) => `${quoteId(column)} = $${index + 1}`).join(" AND ");
  const existing = await remote.get(
    `SELECT id FROM ${quoteId(table)} WHERE ${clauses} AND id <> $${naturalKeys.length + 1} LIMIT 1`,
    ...naturalKeys.map((column) => row[column]),
    row.id
  ) as { id: string } | null;

  if (existing) {
    throw new Error(`${table} has conflicting ${naturalKeys.join("+")} identity for local id ${String(row.id)} and remote id ${existing.id}`);
  }
}

function assertNoSqliteNaturalKeyConflict(db: Database, table: string, row: Row): void {
  const naturalKeys = NATURAL_KEYS[table];
  if (!naturalKeys || naturalKeys.some((column) => !row[column]) || !row.id) return;

  const clauses = naturalKeys.map((column) => `${quoteId(column)} = ?`).join(" AND ");
  const existing = db.query(
    `SELECT id FROM ${quoteId(table)} WHERE ${clauses} AND id <> ? LIMIT 1`
  ).get(...(naturalKeys.map((column) => row[column]) as any[]), row.id) as { id: string } | null;

  if (existing) {
    throw new Error(`${table} has conflicting ${naturalKeys.join("+")} identity for remote id ${String(row.id)} and local id ${existing.id}`);
  }
}

async function upsertPg(remote: PgAdapterAsync, table: string, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;

  const remoteColumns = await getRemoteColumns(remote, table);
  const keyColumns = TABLE_KEYS[table] ?? ["id"];
  let written = 0;

  for (const rawRow of rows) {
    const row = toPgRow(table, rawRow);
    const columns = Object.keys(row).filter((column) => remoteColumns.has(column));
    if (keyColumns.some((column) => !columns.includes(column))) continue;
    await assertNoPgNaturalKeyConflict(remote, table, row);

    const values = columns.map((column) => row[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const immutable = new Set([...(IMMUTABLE_COLUMNS[table] ?? []), ...keyColumns]);
    const updateColumns = columns.filter((column) => !immutable.has(column));
    const updateClause = updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteId(column)} = EXCLUDED.${quoteId(column)}`).join(", ")}`
      : "DO NOTHING";
    const recencyColumn = RECENCY_COLUMNS[table];
    const updateWhere = updateColumns.length > 0 && recencyColumn && columns.includes(recencyColumn)
      ? ` WHERE ${quoteId(table)}.${quoteId(recencyColumn)} IS NULL OR EXCLUDED.${quoteId(recencyColumn)} >= ${quoteId(table)}.${quoteId(recencyColumn)}`
      : "";

    await remote.run(
      `INSERT INTO ${quoteId(table)} (${columns.map(quoteId).join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (${keyColumns.map(quoteId).join(", ")}) ${updateClause}${updateWhere}`,
      ...values
    );
    written++;
  }

  return written;
}

function upsertSqlite(db: Database, table: string, rows: Row[]): number {
  const sqliteColumns = getSqliteColumns(db, table);
  const keyColumns = TABLE_KEYS[table] ?? ["id"];
  let written = 0;

  for (const rawRow of rows) {
    const row = toSqliteRow(table, rawRow);
    const columns = Object.keys(row).filter((column) => sqliteColumns.has(column));
    if (keyColumns.some((column) => !columns.includes(column))) continue;
    assertNoSqliteNaturalKeyConflict(db, table, row);

    const immutable = new Set([...(IMMUTABLE_COLUMNS[table] ?? []), ...keyColumns]);
    const updateColumns = columns.filter((column) => !immutable.has(column));
    const updateClause = updateColumns.length > 0
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteId(column)} = excluded.${quoteId(column)}`).join(", ")}`
      : "DO NOTHING";
    const recencyColumn = RECENCY_COLUMNS[table];
    const updateWhere = updateColumns.length > 0 && recencyColumn && columns.includes(recencyColumn)
      ? ` WHERE ${quoteId(table)}.${quoteId(recencyColumn)} IS NULL OR excluded.${quoteId(recencyColumn)} >= ${quoteId(table)}.${quoteId(recencyColumn)}`
      : "";

    db.query(
      `INSERT INTO ${quoteId(table)} (${columns.map(quoteId).join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})
       ON CONFLICT(${keyColumns.map(quoteId).join(", ")}) ${updateClause}${updateWhere}`
    ).run(...(columns.map((column) => row[column]) as any[]));
    written++;
  }

  return written;
}

export async function getStoragePg(): Promise<PgAdapterAsync> {
  return new PgAdapterAsync(getStorageConnectionString("sandboxes"));
}

export async function runStorageMigrations(remote: PgAdapterAsync): Promise<void> {
  for (const migration of PG_MIGRATIONS) {
    await remote.exec(migration);
  }
}

export function getStorageStatus(db: Database = getDatabase()): StorageStatus {
  const config = getStorageConfig();
  const activeEnv = getStorageDatabaseEnv();
  const configured = Boolean(activeEnv || hasStorageConfigConnection(config));
  return {
    configured,
    mode: config.mode,
    enabled: configured && (config.mode === "hybrid" || config.mode === "remote"),
    env: STORAGE_DATABASE_ENV,
    activeEnv: activeEnv?.name ?? null,
    service: "sandboxes",
    db_path: getDbPath(),
    tables: STORAGE_TABLES.map((table) => {
      try {
        const row = db.query(`SELECT COUNT(*) as count FROM ${quoteId(table)}`).get() as { count: number };
        return { table, rows: row.count };
      } catch {
        return { table, rows: 0 };
      }
    }),
  };
}

export async function getStorageStatusWithRemoteCheck(db: Database = getDatabase()): Promise<StorageStatus> {
  const status = getStorageStatus(db);
  if (!status.configured || !status.enabled) {
    return {
      ...status,
      remote: {
        checked: false,
        ok: false,
        error: status.configured ? "Remote storage is disabled" : "Remote storage is not configured",
      },
    };
  }

  const remote = await getStoragePg();
  try {
    await remote.get("SELECT 1 AS ok");
    return {
      ...status,
      remote: {
        checked: true,
        ok: true,
      },
    };
  } catch (error) {
    return {
      ...status,
      remote: {
        checked: true,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    await remote.close();
  }
}

export function hasSyncErrors(results: SyncResult[]): boolean {
  return results.some((result) => result.errors.length > 0);
}

export function hasSyncBatchErrors(result: { push?: SyncResult[]; pull?: SyncResult[] } | SyncResult[]): boolean {
  if (Array.isArray(result)) return hasSyncErrors(result);
  return hasSyncErrors(result.push ?? []) || hasSyncErrors(result.pull ?? []);
}

export async function pushStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<SyncResult[]> {
  const db = getDatabase();
  const remote = await getStoragePg();
  const results: SyncResult[] = [];

  try {
    await runStorageMigrations(remote);
    for (const table of tables) {
      const result: SyncResult = { table, direction: "push", rowsRead: 0, rowsWritten: 0, errors: [] };
      try {
        const rows = db.query(`SELECT * FROM ${quoteId(table)}`).all() as Row[];
        result.rowsRead = rows.length;
        result.rowsWritten = await upsertPg(remote, table, rows);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      results.push(result);
    }
  } finally {
    await remote.close();
  }

  return results;
}

export async function pullStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<SyncResult[]> {
  const db = getDatabase();
  const remote = await getStoragePg();
  const results: SyncResult[] = [];

  try {
    await runStorageMigrations(remote);
    for (const table of tables) {
      const result: SyncResult = { table, direction: "pull", rowsRead: 0, rowsWritten: 0, errors: [] };
      try {
        const rows = await remote.all(`SELECT * FROM ${quoteId(table)}`) as Row[];
        result.rowsRead = rows.length;
        result.rowsWritten = upsertSqlite(db, table, rows);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
      results.push(result);
    }
  } finally {
    await remote.close();
  }

  return results;
}

export async function syncStorageChanges(tables: string[] = [...STORAGE_TABLES]): Promise<{ push: SyncResult[]; pull: SyncResult[] }> {
  return {
    push: await pushStorageChanges(tables),
    pull: await pullStorageChanges(tables),
  };
}

export function parseStorageTables(raw?: string): string[] {
  if (!raw) return [...STORAGE_TABLES];
  const requested = raw.split(",").map((table) => table.trim()).filter(Boolean);
  if (requested.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown sandboxes sync table(s): ${invalid.join(", ")}`);
  return requested;
}
