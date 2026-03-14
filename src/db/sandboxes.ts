import { getDatabase, uuid, now, resolvePartialId } from "./database";
import type {
  Sandbox,
  SandboxRow,
  CreateSandboxInput,
  SandboxStatus,
  SandboxProviderName,
} from "../types/index";
import { SandboxNotFoundError } from "../types/index";

// ── Row conversion ────────────────────────────────────────────────────

export function rowToSandbox(row: SandboxRow): Sandbox {
  return {
    id: row.id,
    provider: row.provider as SandboxProviderName,
    provider_sandbox_id: row.provider_sandbox_id,
    name: row.name,
    status: row.status as SandboxStatus,
    image: row.image,
    timeout: row.timeout,
    config: JSON.parse(row.config),
    env_vars: JSON.parse(row.env_vars),
    keep_alive_until: row.keep_alive_until,
    project_id: row.project_id,
    on_timeout: (row.on_timeout as 'pause' | 'terminate') ?? 'terminate',
    auto_resume: row.auto_resume === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────

export function createSandbox(input: CreateSandboxInput): Sandbox {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  const provider = input.provider ?? "e2b";
  const name = input.name ?? null;
  const image = input.image ?? null;
  const timeout = input.timeout ?? 3600;
  const config = JSON.stringify(input.config ?? {});
  const env_vars = JSON.stringify(input.env_vars ?? {});
  const project_id = input.project_id ?? null;
  const on_timeout = input.on_timeout ?? 'terminate';
  const auto_resume = input.auto_resume ? 1 : 0;

  db.query(
    `INSERT INTO sandboxes (id, provider, name, status, image, timeout, config, env_vars, project_id, on_timeout, auto_resume, created_at, updated_at)
     VALUES (?, ?, ?, 'creating', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    provider,
    name,
    image,
    timeout,
    config,
    env_vars,
    project_id,
    on_timeout,
    auto_resume,
    timestamp,
    timestamp
  );

  return getSandbox(id);
}

export function getSandbox(id: string): Sandbox {
  const db = getDatabase();

  const resolvedId = resolvePartialId("sandboxes", id);
  if (!resolvedId) throw new SandboxNotFoundError(id);

  const row = db
    .query("SELECT * FROM sandboxes WHERE id = ?")
    .get(resolvedId) as SandboxRow | null;

  if (!row) throw new SandboxNotFoundError(id);
  return rowToSandbox(row);
}

export function listSandboxes(opts?: {
  status?: SandboxStatus;
  provider?: SandboxProviderName;
  project_id?: string;
}): Sandbox[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts?.provider) {
    conditions.push("provider = ?");
    params.push(opts.provider);
  }
  if (opts?.project_id) {
    conditions.push("project_id = ?");
    params.push(opts.project_id);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM sandboxes${where} ORDER BY created_at DESC`)
    .all(...(params as string[])) as SandboxRow[];

  return rows.map(rowToSandbox);
}

export function updateSandbox(
  id: string,
  updates: Partial<
    Pick<
      Sandbox,
      | "status"
      | "provider_sandbox_id"
      | "name"
      | "image"
      | "timeout"
      | "config"
      | "env_vars"
      | "keep_alive_until"
    >
  >
): Sandbox {
  const db = getDatabase();

  const resolvedId = resolvePartialId("sandboxes", id);
  if (!resolvedId) throw new SandboxNotFoundError(id);

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    setClauses.push("status = ?");
    params.push(updates.status);
  }
  if (updates.provider_sandbox_id !== undefined) {
    setClauses.push("provider_sandbox_id = ?");
    params.push(updates.provider_sandbox_id);
  }
  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    params.push(updates.name);
  }
  if (updates.image !== undefined) {
    setClauses.push("image = ?");
    params.push(updates.image);
  }
  if (updates.timeout !== undefined) {
    setClauses.push("timeout = ?");
    params.push(updates.timeout);
  }
  if (updates.config !== undefined) {
    setClauses.push("config = ?");
    params.push(JSON.stringify(updates.config));
  }
  if (updates.env_vars !== undefined) {
    setClauses.push("env_vars = ?");
    params.push(JSON.stringify(updates.env_vars));
  }
  if (updates.keep_alive_until !== undefined) {
    setClauses.push("keep_alive_until = ?");
    params.push(updates.keep_alive_until);
  }

  if (setClauses.length === 0) {
    return getSandbox(resolvedId);
  }

  setClauses.push("updated_at = ?");
  params.push(now());
  params.push(resolvedId);

  db.query(
    `UPDATE sandboxes SET ${setClauses.join(", ")} WHERE id = ?`
  ).run(...(params as string[]));

  return getSandbox(resolvedId);
}

export function deleteSandbox(id: string): void {
  const db = getDatabase();

  const resolvedId = resolvePartialId("sandboxes", id);
  if (!resolvedId) throw new SandboxNotFoundError(id);

  db.query("DELETE FROM sandboxes WHERE id = ?").run(resolvedId);
}
