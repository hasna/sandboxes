// ── Constants ──────────────────────────────────────────────────────────

export const SANDBOX_PROVIDERS = ["e2b", "daytona", "modal"] as const;
export type SandboxProviderName = (typeof SANDBOX_PROVIDERS)[number];

export const SANDBOX_STATUSES = [
  "creating",
  "running",
  "paused",
  "stopped",
  "deleted",
  "error",
] as const;
export type SandboxStatus = (typeof SANDBOX_STATUSES)[number];

export const SESSION_STATUSES = [
  "running",
  "completed",
  "failed",
  "killed",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const AGENT_TYPES = ["claude", "codex", "gemini", "opencode", "pi", "custom"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const EVENT_TYPES = [
  "stdout",
  "stderr",
  "lifecycle",
  "agent",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ── Sandbox ────────────────────────────────────────────────────────────

export interface Sandbox {
  id: string;
  provider: SandboxProviderName;
  provider_sandbox_id: string | null;
  name: string | null;
  status: SandboxStatus;
  image: string | null;
  timeout: number;
  config: Record<string, unknown>;
  env_vars: Record<string, string>;
  keep_alive_until: string | null;
  project_id: string | null;
  on_timeout: 'pause' | 'terminate';
  auto_resume: boolean;
  budget_limit_usd: number | null;
  on_budget_exceeded: 'terminate' | 'pause' | 'notify';
  started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SandboxRow {
  id: string;
  provider: string;
  provider_sandbox_id: string | null;
  name: string | null;
  status: string;
  image: string | null;
  timeout: number;
  config: string;
  env_vars: string;
  keep_alive_until: string | null;
  project_id: string | null;
  on_timeout: string;
  auto_resume: number;
  budget_limit_usd: number | null;
  on_budget_exceeded: string;
  started_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSandboxInput {
  provider?: SandboxProviderName;
  name?: string;
  image?: string;
  timeout?: number;
  env_vars?: Record<string, string>;
  config?: Record<string, unknown>;
  project_id?: string;
  on_timeout?: 'pause' | 'terminate';
  auto_resume?: boolean;
  template_id?: string;
  network?: 'full' | 'restricted' | 'none';
  budget_limit_usd?: number;
  on_budget_exceeded?: 'terminate' | 'pause' | 'notify';
}

// ── Session ────────────────────────────────────────────────────────────

export interface SandboxSession {
  id: string;
  sandbox_id: string;
  agent_name: string | null;
  agent_type: AgentType | null;
  command: string | null;
  status: SessionStatus;
  exit_code: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface SandboxSessionRow {
  id: string;
  sandbox_id: string;
  agent_name: string | null;
  agent_type: string | null;
  command: string | null;
  status: string;
  exit_code: number | null;
  started_at: string;
  ended_at: string | null;
}

export interface CreateSessionInput {
  sandbox_id: string;
  agent_name?: string;
  agent_type?: AgentType;
  command?: string;
}

// ── Event ──────────────────────────────────────────────────────────────

export interface SandboxEvent {
  id: string;
  sandbox_id: string;
  session_id: string | null;
  type: EventType;
  data: string | null;
  created_at: string;
}

export interface SandboxEventRow {
  id: string;
  sandbox_id: string;
  session_id: string | null;
  type: string;
  data: string | null;
  created_at: string;
}

// ── Agent ──────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string;
}

export interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  metadata: string;
  created_at: string;
  last_seen_at: string;
}

export interface RegisterAgentInput {
  name: string;
  description?: string;
}

// ── Project ────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  description?: string;
}

// ── Webhook ────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  created_at: string;
}

export interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string | null;
  active: number;
  created_at: string;
}

export interface CreateWebhookInput {
  url: string;
  events?: string[];
  secret?: string;
}

// ── Provider types ─────────────────────────────────────────────────────

export interface ExecResult {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface ExecHandle {
  kill: () => Promise<void>;
  wait: () => Promise<ExecResult>;
}

export interface FileInfo {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
}

// ── Config ─────────────────────────────────────────────────────────────

export interface SandboxesConfig {
  default_provider?: SandboxProviderName;
  default_image?: string;
  default_timeout?: number;
  providers?: {
    e2b?: { api_key?: string };
    daytona?: { api_key?: string; target?: string };
    modal?: { api_key?: string };
  };
}

// ── Errors ─────────────────────────────────────────────────────────────

export class SandboxNotFoundError extends Error {
  constructor(id: string) {
    super(`Sandbox not found: ${id}`);
    this.name = "SandboxNotFoundError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session not found: ${id}`);
    this.name = "SessionNotFoundError";
  }
}

export class ProviderError extends Error {
  provider: string;
  constructor(provider: string, message: string) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

export class AgentNotFoundError extends Error {
  constructor(id: string) {
    super(`Agent not found: ${id}`);
    this.name = "AgentNotFoundError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

export class WebhookNotFoundError extends Error {
  constructor(id: string) {
    super(`Webhook not found: ${id}`);
    this.name = "WebhookNotFoundError";
  }
}

export class TemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Template not found: ${id}`);
    this.name = "TemplateNotFoundError";
  }
}

// ── Template ───────────────────────────────────────────────────────────

export interface Template {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  env_vars: Record<string, string>;
  setup_script: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  env_vars: string;
  setup_script: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  image?: string;
  env_vars?: Record<string, string>;
  setup_script?: string;
  tags?: string[];
}
