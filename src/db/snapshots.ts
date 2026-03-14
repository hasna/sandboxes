import { getDatabase, uuid, now, resolvePartialId } from "./database.js";

export interface Snapshot {
  id: string;
  sandbox_id: string;
  provider_sandbox_id: string;
  provider: string;
  name: string | null;
  created_at: string;
}

export interface SnapshotRow {
  id: string;
  sandbox_id: string;
  provider_sandbox_id: string;
  provider: string;
  name: string | null;
  created_at: string;
}

export class SnapshotNotFoundError extends Error {
  constructor(id: string) {
    super(`Snapshot not found: ${id}`);
    this.name = "SnapshotNotFoundError";
  }
}

export function createSnapshot(input: {
  sandbox_id: string;
  provider_sandbox_id: string;
  provider: string;
  name?: string;
}): Snapshot {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();
  db.query(
    `INSERT INTO snapshots (id, sandbox_id, provider_sandbox_id, provider, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.sandbox_id, input.provider_sandbox_id, input.provider, input.name ?? null, timestamp);
  return getSnapshot(id);
}

export function getSnapshot(id: string): Snapshot {
  const db = getDatabase();
  const resolvedId = resolvePartialId("snapshots", id);
  if (!resolvedId) throw new SnapshotNotFoundError(id);
  const row = db.query("SELECT * FROM snapshots WHERE id = ?").get(resolvedId) as SnapshotRow | null;
  if (!row) throw new SnapshotNotFoundError(id);
  return row;
}

export function listSnapshots(sandboxId?: string): Snapshot[] {
  const db = getDatabase();
  if (sandboxId) {
    return db.query("SELECT * FROM snapshots WHERE sandbox_id = ? ORDER BY created_at DESC").all(sandboxId) as Snapshot[];
  }
  return db.query("SELECT * FROM snapshots ORDER BY created_at DESC").all() as Snapshot[];
}

export function deleteSnapshot(id: string): void {
  const db = getDatabase();
  const resolvedId = resolvePartialId("snapshots", id);
  if (!resolvedId) throw new SnapshotNotFoundError(id);
  db.query("DELETE FROM snapshots WHERE id = ?").run(resolvedId);
}
