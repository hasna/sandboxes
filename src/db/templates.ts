import { getDatabase, uuid, now, resolvePartialId } from "./database.js";
import type { Template, TemplateRow, CreateTemplateInput } from "../types/index.js";
import { TemplateNotFoundError } from "../types/index.js";

function rowToTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    image: row.image,
    env_vars: JSON.parse(row.env_vars),
    setup_script: row.setup_script,
    tags: JSON.parse(row.tags),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createTemplate(input: CreateTemplateInput): Template {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();
  db.query(
    `INSERT INTO templates (id, name, description, image, env_vars, setup_script, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.name, input.description ?? null, input.image ?? null,
    JSON.stringify(input.env_vars ?? {}), input.setup_script ?? null,
    JSON.stringify(input.tags ?? []), timestamp, timestamp
  );
  return getTemplate(id);
}

export function getTemplate(id: string): Template {
  const db = getDatabase();
  const resolvedId = resolvePartialId("templates", id);
  if (!resolvedId) throw new TemplateNotFoundError(id);
  const row = db.query("SELECT * FROM templates WHERE id = ?").get(resolvedId) as TemplateRow | null;
  if (!row) throw new TemplateNotFoundError(id);
  return rowToTemplate(row);
}

export function getTemplateByName(name: string): Template | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM templates WHERE name = ?").get(name) as TemplateRow | null;
  return row ? rowToTemplate(row) : null;
}

export function listTemplates(): Template[] {
  const db = getDatabase();
  const rows = db.query("SELECT * FROM templates ORDER BY name ASC").all() as TemplateRow[];
  return rows.map(rowToTemplate);
}

export function deleteTemplate(id: string): void {
  const db = getDatabase();
  const resolvedId = resolvePartialId("templates", id);
  if (!resolvedId) throw new TemplateNotFoundError(id);
  db.query("DELETE FROM templates WHERE id = ?").run(resolvedId);
}
