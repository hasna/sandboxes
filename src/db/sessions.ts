import { getDatabase, uuid, now, resolvePartialId } from "./database";
import type {
  SandboxSession,
  SandboxSessionRow,
  CreateSessionInput,
  SessionStatus,
} from "../types/index";
import { SessionNotFoundError } from "../types/index";

export function rowToSession(row: SandboxSessionRow): SandboxSession {
  return {
    ...row,
    agent_type: row.agent_type as SandboxSession["agent_type"],
    status: row.status as SessionStatus,
  };
}

export function createSession(input: CreateSessionInput): SandboxSession {
  const db = getDatabase();
  const id = uuid();
  const startedAt = now();

  db.query(
    `INSERT INTO sandbox_sessions (id, sandbox_id, agent_name, agent_type, command, status, started_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`
  ).run(
    id,
    input.sandbox_id,
    input.agent_name ?? null,
    input.agent_type ?? null,
    input.command ?? null,
    startedAt
  );

  return getSession(id);
}

export function getSession(id: string): SandboxSession {
  const db = getDatabase();
  const resolvedId = resolvePartialId("sandbox_sessions", id) ?? id;

  const row = db
    .query("SELECT * FROM sandbox_sessions WHERE id = ?")
    .get(resolvedId) as SandboxSessionRow | null;

  if (!row) throw new SessionNotFoundError(id);

  return rowToSession(row);
}

export function listSessions(opts?: {
  sandbox_id?: string;
  status?: SessionStatus;
}): SandboxSession[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.sandbox_id) {
    conditions.push("sandbox_id = ?");
    params.push(opts.sandbox_id);
  }

  if (opts?.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM sandbox_sessions ${where} ORDER BY started_at DESC`)
    .all(...(params as string[])) as SandboxSessionRow[];

  return rows.map(rowToSession);
}

export function updateSession(
  id: string,
  updates: Partial<Pick<SandboxSession, "status" | "exit_code">>
): SandboxSession {
  const session = getSession(id);
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    params.push(updates.status);
  }

  if (updates.exit_code !== undefined) {
    sets.push("exit_code = ?");
    params.push(updates.exit_code);
  }

  if (sets.length === 0) return session;

  const db = getDatabase();
  params.push(session.id);
  db.query(`UPDATE sandbox_sessions SET ${sets.join(", ")} WHERE id = ?`).run(
    ...(params as string[])
  );

  return getSession(session.id);
}

export function endSession(
  id: string,
  exit_code: number,
  status?: SessionStatus
): SandboxSession {
  const session = getSession(id);
  const endedAt = now();
  const finalStatus: SessionStatus = status ?? "completed";

  const db = getDatabase();
  db.query(
    `UPDATE sandbox_sessions SET status = ?, exit_code = ?, ended_at = ? WHERE id = ?`
  ).run(finalStatus, exit_code, endedAt, session.id);

  return getSession(session.id);
}
