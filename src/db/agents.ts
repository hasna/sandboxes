import { getDatabase, uuid, now, resolvePartialId } from "./database";
import type { Agent, AgentRow, RegisterAgentInput } from "../types/index";
import { AgentNotFoundError } from "../types/index";

// ── Row conversion ────────────────────────────────────────────────────

export function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    metadata: JSON.parse(row.metadata),
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────

export function registerAgent(input: RegisterAgentInput): Agent {
  const db = getDatabase();
  const timestamp = now();

  const existing = getAgentByName(input.name);
  if (existing) {
    db.query("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(
      timestamp,
      existing.id
    );
    return getAgent(existing.id);
  }

  const id = uuid();
  const description = input.description ?? null;

  db.query(
    `INSERT OR IGNORE INTO agents (id, name, description, metadata, created_at, last_seen_at)
     VALUES (?, ?, ?, '{}', ?, ?)`
  ).run(id, input.name, description, timestamp, timestamp);

  return getAgent(id);
}

export function getAgent(id: string): Agent {
  const db = getDatabase();

  const resolvedId = resolvePartialId("agents", id);
  if (!resolvedId) throw new AgentNotFoundError(id);

  const row = db
    .query("SELECT * FROM agents WHERE id = ?")
    .get(resolvedId) as AgentRow | null;

  if (!row) throw new AgentNotFoundError(id);
  return rowToAgent(row);
}

export function getAgentByName(name: string): Agent | null {
  const db = getDatabase();

  const row = db
    .query("SELECT * FROM agents WHERE name = ?")
    .get(name) as AgentRow | null;

  if (!row) return null;
  return rowToAgent(row);
}

export function listAgents(): Agent[] {
  const db = getDatabase();

  const rows = db
    .query("SELECT * FROM agents ORDER BY last_seen_at DESC")
    .all() as AgentRow[];

  return rows.map(rowToAgent);
}

export function heartbeatAgent(idOrName: string): Agent {
  const db = getDatabase();
  const agent = getAgentByName(idOrName) ?? (() => { try { return getAgent(idOrName); } catch { return null; } })();
  if (!agent) throw new AgentNotFoundError(idOrName);
  db.query("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(now(), agent.id);
  return getAgent(agent.id);
}

export function setAgentFocus(idOrName: string, projectId: string | null): Agent {
  const db = getDatabase();
  const agent = getAgentByName(idOrName) ?? (() => { try { return getAgent(idOrName); } catch { return null; } })();
  if (!agent) throw new AgentNotFoundError(idOrName);
  db.query("UPDATE agents SET active_project_id = ?, last_seen_at = ? WHERE id = ?").run(projectId, now(), agent.id);
  return getAgent(agent.id);
}

export function deleteAgent(id: string): void {
  const db = getDatabase();

  const resolvedId = resolvePartialId("agents", id);
  if (!resolvedId) throw new AgentNotFoundError(id);

  db.query("DELETE FROM agents WHERE id = ?").run(resolvedId);
}
