import { getDatabase, uuid } from "./database";
import type { SandboxEvent, SandboxEventRow, EventType } from "../types/index";

// ── Row conversion ────────────────────────────────────────────────────

export function rowToEvent(row: SandboxEventRow): SandboxEvent {
  return {
    id: row.id,
    sandbox_id: row.sandbox_id,
    session_id: row.session_id,
    type: row.type as EventType,
    data: row.data,
    created_at: row.created_at,
  };
}

// ── Append-only operations ───────────────────────────────────────────

export function addEvent(input: {
  sandbox_id: string;
  session_id?: string;
  type: EventType;
  data?: string;
}): SandboxEvent {
  const db = getDatabase();
  const id = uuid();

  db.query(
    `INSERT INTO sandbox_events (id, sandbox_id, session_id, type, data)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.sandbox_id, input.session_id ?? null, input.type, input.data ?? null);

  const row = db
    .query("SELECT * FROM sandbox_events WHERE id = ?")
    .get(id) as SandboxEventRow;

  return rowToEvent(row);
}

export function listEvents(opts?: {
  sandbox_id?: string;
  session_id?: string;
  type?: EventType;
  limit?: number;
  offset?: number;
}): SandboxEvent[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.sandbox_id) {
    conditions.push("sandbox_id = ?");
    params.push(opts.sandbox_id);
  }
  if (opts?.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts?.type) {
    conditions.push("type = ?");
    params.push(opts.type);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;

  const rows = db
    .query(`SELECT * FROM sandbox_events${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`)
    .all(...([...params, limit, offset] as (string | number)[])) as SandboxEventRow[];

  return rows.map(rowToEvent);
}
