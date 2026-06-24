import type {
  Agent,
  Project,
  Sandbox,
  SandboxEvent,
  SandboxSession,
  Template,
  FileInfo,
} from "../types/index.js";
import type { Snapshot } from "../db/snapshots.js";

export const DEFAULT_LIST_LIMIT = 20;
export const DEFAULT_LOG_LIMIT = 50;
export const DEFAULT_TEXT_LIMIT = 1200;
export const MAX_LIST_LIMIT = 200;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  cursor: number;
  next_cursor: number | null;
}

export function shortId(id: string | null | undefined, length = 8): string {
  return id ? id.slice(0, length) : "";
}

export function parseNonNegativeInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function parseLimit(value: unknown, fallback = DEFAULT_LIST_LIMIT): number {
  const parsed = parseNonNegativeInt(value, fallback);
  if (parsed === 0) return fallback;
  return Math.min(parsed, MAX_LIST_LIMIT);
}

export function pageItems<T>(
  items: T[],
  opts: { limit?: unknown; cursor?: unknown; defaultLimit?: number } = {}
): Page<T> {
  const limit = parseLimit(opts.limit, opts.defaultLimit ?? DEFAULT_LIST_LIMIT);
  const cursor = parseNonNegativeInt(opts.cursor, 0);
  const page = items.slice(cursor, cursor + limit);
  const next = cursor + page.length;
  return {
    items: page,
    total: items.length,
    limit,
    cursor,
    next_cursor: next < items.length ? next : null,
  };
}

export function truncateText(value: unknown, max = DEFAULT_TEXT_LIMIT): string {
  const text = value === undefined || value === null ? "" : String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function wasTruncated(value: unknown, max = DEFAULT_TEXT_LIMIT): boolean {
  const text = value === undefined || value === null ? "" : String(value);
  return text.length > max;
}

export function truncateEncodedContent(
  value: unknown,
  encoding: "utf8" | "base64" | "hex" = "utf8",
  max = DEFAULT_TEXT_LIMIT
): { text: string; truncated: boolean } {
  const text = value === undefined || value === null ? "" : String(value);
  const limit = Math.max(0, parseNonNegativeInt(max, DEFAULT_TEXT_LIMIT));
  if (text.length <= limit) return { text, truncated: false };
  if (limit === 0) return { text: "", truncated: true };

  if (encoding === "base64") {
    const safeLength = Math.floor(limit / 4) * 4;
    return { text: text.slice(0, safeLength), truncated: true };
  }

  if (encoding === "hex") {
    const safeLength = Math.floor(limit / 2) * 2;
    return { text: text.slice(0, safeLength), truncated: true };
  }

  return { text: truncateText(text, limit), truncated: true };
}

export function keySummary(value: Record<string, unknown> | Record<string, string> | null | undefined): {
  count: number;
  keys: string[];
} {
  const keys = Object.keys(value ?? {});
  return { count: keys.length, keys };
}

export function compactSandbox(
  sandbox: Sandbox,
  opts: { verbose?: boolean; cost?: { compute_seconds: number; cost_usd: number } } = {}
) {
  const base = {
    id: sandbox.id,
    short_id: shortId(sandbox.id),
    name: sandbox.name,
    provider: sandbox.provider,
    status: sandbox.status,
    image: truncateText(sandbox.image ?? "default", opts.verbose ? 240 : 80),
    created_at: sandbox.created_at,
    provider_sandbox_id: sandbox.provider_sandbox_id,
    ...(opts.cost ?? {}),
  };

  if (!opts.verbose) return base;

  return {
    ...base,
    timeout: sandbox.timeout,
    updated_at: sandbox.updated_at,
    keep_alive_until: sandbox.keep_alive_until,
    project_id: sandbox.project_id,
    env_vars: sandbox.env_vars,
    config: sandbox.config,
    on_timeout: sandbox.on_timeout,
    auto_resume: sandbox.auto_resume,
    budget_limit_usd: sandbox.budget_limit_usd,
    on_budget_exceeded: sandbox.on_budget_exceeded,
  };
}

export function sandboxDetail(sandbox: Sandbox, opts: { verbose?: boolean } = {}) {
  if (opts.verbose) return sandbox;
  return {
    id: sandbox.id,
    short_id: shortId(sandbox.id),
    name: sandbox.name,
    provider: sandbox.provider,
    provider_sandbox_id: sandbox.provider_sandbox_id,
    status: sandbox.status,
    image: sandbox.image,
    timeout: sandbox.timeout,
    created_at: sandbox.created_at,
    updated_at: sandbox.updated_at,
    env_vars: keySummary(sandbox.env_vars),
    config: keySummary(sandbox.config as Record<string, unknown>),
    hint: "Use verbose:true for env var values and full config, or get_sandbox/show for details.",
  };
}

export function compactEvent(event: SandboxEvent, opts: { verbose?: boolean; maxText?: number } = {}) {
  const maxText = opts.maxText ?? DEFAULT_TEXT_LIMIT;
  return {
    id: event.id,
    short_id: shortId(event.id),
    sandbox_id: event.sandbox_id,
    session_id: event.session_id,
    type: event.type,
    data: opts.verbose ? event.data : truncateText(event.data ?? "", maxText),
    data_truncated: opts.verbose ? false : wasTruncated(event.data ?? "", maxText),
    created_at: event.created_at,
  };
}

export function compactAgent(agent: Agent, opts: { verbose?: boolean } = {}) {
  return {
    id: agent.id,
    short_id: shortId(agent.id),
    name: agent.name,
    description: opts.verbose ? agent.description : truncateText(agent.description ?? "", 120),
    last_seen_at: agent.last_seen_at,
    ...(opts.verbose ? { metadata: agent.metadata, created_at: agent.created_at } : {}),
  };
}

export function compactProject(project: Project, opts: { verbose?: boolean } = {}) {
  return {
    id: project.id,
    short_id: shortId(project.id),
    name: project.name,
    path: opts.verbose ? project.path : truncateText(project.path, 100),
    description: opts.verbose ? project.description : truncateText(project.description ?? "", 120),
    updated_at: project.updated_at,
    ...(opts.verbose ? { created_at: project.created_at } : {}),
  };
}

export function compactTemplate(template: Template, opts: { verbose?: boolean } = {}) {
  return {
    id: template.id,
    short_id: shortId(template.id),
    name: template.name,
    description: opts.verbose ? template.description : truncateText(template.description ?? "", 120),
    image: template.image,
    env_var_count: Object.keys(template.env_vars).length,
    has_setup_script: Boolean(template.setup_script),
    tags: template.tags,
    updated_at: template.updated_at,
    ...(opts.verbose
      ? { env_vars: template.env_vars, setup_script: template.setup_script, created_at: template.created_at }
      : {}),
  };
}

export function compactSnapshot(snapshot: Snapshot) {
  return {
    id: snapshot.id,
    short_id: shortId(snapshot.id),
    sandbox_id: snapshot.sandbox_id,
    provider: snapshot.provider,
    name: snapshot.name,
    created_at: snapshot.created_at,
  };
}

export function compactFile(file: FileInfo, opts: { verbose?: boolean } = {}) {
  return {
    name: truncateText(file.name, opts.verbose ? 240 : 100),
    path: opts.verbose ? file.path : undefined,
    type: file.is_dir ? "dir" : "file",
    size: file.is_dir ? null : file.size,
  };
}

export function compactSession(session: SandboxSession) {
  return {
    id: session.id,
    short_id: shortId(session.id),
    sandbox_id: session.sandbox_id,
    agent_name: session.agent_name,
    agent_type: session.agent_type,
    command: truncateText(session.command ?? "", 160),
    status: session.status,
    exit_code: session.exit_code,
    started_at: session.started_at,
    ended_at: session.ended_at,
  };
}

export function pagedResponse<T>(
  allItems: T[],
  opts: {
    limit?: unknown;
    cursor?: unknown;
    defaultLimit?: number;
    hint?: string;
  } = {}
) {
  const page = pageItems(allItems, opts);
  return {
    items: page.items,
    total: page.total,
    limit: page.limit,
    cursor: page.cursor,
    next_cursor: page.next_cursor,
    hint: page.next_cursor === null
      ? opts.hint
      : `Use cursor:${page.next_cursor} for the next page. ${opts.hint ?? ""}`.trim(),
  };
}
