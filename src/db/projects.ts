import { getDatabase, uuid, now, resolvePartialId } from "./database";
import type { Project, CreateProjectInput } from "../types/index";
import { ProjectNotFoundError } from "../types/index";

// ── Row conversion ────────────────────────────────────────────────────

export function rowToProject(row: Project): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────

export function createProject(input: CreateProjectInput): Project {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();
  const description = input.description ?? null;

  db.query(
    `INSERT INTO projects (id, name, path, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.path, description, timestamp, timestamp);

  return getProject(id);
}

export function getProject(id: string): Project {
  const db = getDatabase();

  const resolvedId = resolvePartialId("projects", id);
  if (!resolvedId) throw new ProjectNotFoundError(id);

  const row = db
    .query("SELECT * FROM projects WHERE id = ?")
    .get(resolvedId) as Project | null;

  if (!row) throw new ProjectNotFoundError(id);
  return rowToProject(row);
}

export function getProjectByPath(path: string): Project | null {
  const db = getDatabase();

  const row = db
    .query("SELECT * FROM projects WHERE path = ?")
    .get(path) as Project | null;

  if (!row) return null;
  return rowToProject(row);
}

export function listProjects(): Project[] {
  const db = getDatabase();

  const rows = db
    .query("SELECT * FROM projects ORDER BY created_at DESC")
    .all() as Project[];

  return rows.map(rowToProject);
}

export function ensureProject(name: string, path: string): Project {
  const existing = getProjectByPath(path);
  if (existing) return existing;

  return createProject({ name, path });
}

export function deleteProject(id: string): void {
  const db = getDatabase();

  const resolvedId = resolvePartialId("projects", id);
  if (!resolvedId) throw new ProjectNotFoundError(id);

  db.query("DELETE FROM projects WHERE id = ?").run(resolvedId);
}
