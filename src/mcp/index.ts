#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  createSandbox,
  getSandbox,
  listSandboxes,
  updateSandbox,
  deleteSandbox as deleteSandboxDb,
} from "../db/sandboxes.js";
import { createSession, getSession } from "../db/sessions.js";
import { listEvents } from "../db/events.js";
import { registerAgent, listAgents } from "../db/agents.js";
import {
  listProjects,
  ensureProject,
} from "../db/projects.js";
import { createTemplate, getTemplate, listTemplates, deleteTemplate } from "../db/templates.js";
import { createSnapshot, getSnapshot, listSnapshots, deleteSnapshot } from "../db/snapshots.js";
import { getProvider } from "../providers/index.js";
import { getDefaultProvider, getDefaultTimeout } from "../lib/config.js";
import { createStreamCollector, emitLifecycleEvent } from "../lib/stream.js";
import { runAgent as runAgentLib, stopAgent as stopAgentLib } from "../lib/agent-runner.js";
import {
  finalizeSandboxProvisionFailure,
  finalizeSessionExit,
  finalizeSessionFailure,
} from "../lib/runtime-state.js";
import { resolveImage, getBuiltinImageSetupScript, BUILTIN_IMAGES } from "../lib/images.js";
import { getPackageVersion } from "../lib/version.js";
import type { ExecResult, AgentType } from "../types/index.js";

// ── Cost constants ────────────────────────────────────────────────────
const E2B_COST_PER_SECOND = 0.000014;
const DAYTONA_COST_PER_SECOND = 0.000010;

function estimateCost(providerName: string, startedAt: string | null): { compute_seconds: number; cost_usd: number } {
  if (!startedAt) return { compute_seconds: 0, cost_usd: 0 };
  const seconds = (Date.now() - new Date(startedAt).getTime()) / 1000;
  const rate = providerName === 'daytona' ? DAYTONA_COST_PER_SECOND : E2B_COST_PER_SECOND;
  return {
    compute_seconds: Math.round(seconds),
    cost_usd: Math.round(seconds * rate * 1000000) / 1000000,
  };
}

// In-memory registry of exposed ports: sandboxId -> Map<port, url>
const exposedPorts = new Map<string, Map<number, string>>();

// ── Helpers ──────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${(error as Error).message}` }],
    isError: true as const,
  };
}

// ── Tool catalog (for describe_tools / search_tools) ─────────────────

const TOOL_CATALOG: { name: string; description: string }[] = [
  { name: "create_sandbox", description: "Create a new sandbox" },
  { name: "get_sandbox", description: "Get sandbox details by ID" },
  { name: "list_sandboxes", description: "List sandboxes with filters" },
  { name: "delete_sandbox", description: "Delete a sandbox" },
  { name: "stop_sandbox", description: "Stop a running sandbox" },
  { name: "keep_alive", description: "Extend sandbox lifetime" },
  { name: "exec_command", description: "Execute a command in a sandbox" },
  { name: "read_file", description: "Read a file from a sandbox" },
  { name: "write_file", description: "Write a file to a sandbox" },
  { name: "list_files", description: "List files in a sandbox directory" },
  { name: "get_session", description: "Get session details and exit code (useful for background commands)" },
  { name: "get_logs", description: "Get sandbox/session event logs" },
  { name: "register_agent", description: "Register an agent" },
  { name: "list_agents", description: "List all registered agents" },
  { name: "register_project", description: "Register a project" },
  { name: "list_projects", description: "List all projects" },
  { name: "describe_tools", description: "List all available tools" },
  { name: "search_tools", description: "Search tools by keyword" },
  { name: "pause_sandbox", description: "Pause a running sandbox, saving its state for later resume" },
  { name: "resume_sandbox", description: "Resume a paused sandbox" },
  { name: "create_template", description: "Create a reusable sandbox template" },
  { name: "list_templates", description: "List all sandbox templates" },
  { name: "get_template", description: "Get a sandbox template by ID" },
  { name: "delete_template", description: "Delete a sandbox template" },
  { name: "get_sandbox_status", description: "Get running processes, disk usage and uptime in a sandbox" },
  { name: "snapshot_sandbox", description: "Capture sandbox filesystem state as a snapshot" },
  { name: "list_snapshots", description: "List filesystem snapshots" },
  { name: "delete_snapshot", description: "Delete a snapshot" },
  { name: "expose_port", description: "Forward a sandbox port and get a public URL" },
  { name: "list_exposed_ports", description: "List all forwarded ports for a sandbox" },
  { name: "close_port", description: "Stop forwarding a sandbox port" },
  { name: "get_network_log", description: "Get outbound network connections from a sandbox" },
  { name: "watch_file", description: "Get new content from a file since a previous read (tail -f equivalent)" },
  { name: "list_images", description: "List available pre-warmed sandbox image aliases" },
];

// ── Server ───────────────────────────────────────────────────────────

const server = new McpServer({
  name: "sandboxes",
  version: getPackageVersion(),
});

// 1. create_sandbox
server.tool(
  "create_sandbox",
  "Create a new sandbox",
  {
    provider: z.string().optional().describe("Provider name (e2b, daytona, modal)"),
    image: z.string().optional().describe("Container image"),
    timeout: z.number().optional().describe("Timeout in seconds"),
    name: z.string().optional().describe("Sandbox name"),
    env_vars: z.record(z.string()).optional().describe("Environment variables"),
    template_id: z.string().optional().describe("Template ID to base this sandbox on"),
    on_timeout: z.enum(['pause', 'terminate']).optional().describe("What to do on timeout: pause (saves state) or terminate"),
    auto_resume: z.boolean().optional().describe("Auto-resume paused sandbox on next connect"),
    snapshot_id: z.string().optional().describe("Snapshot ID to restore from"),
    network: z.enum(['full', 'restricted', 'none']).optional().describe("Network access policy for the sandbox"),
    budget_limit_usd: z.number().optional().describe("Auto-terminate sandbox if compute cost exceeds this USD amount"),
    on_budget_exceeded: z.enum(['terminate', 'pause', 'notify']).optional().describe("Action when budget limit is reached (default: terminate)"),
  },
  async (params) => {
    let sandboxId: string | undefined;
    try {
      const providerName = (params.provider ?? getDefaultProvider()) as "e2b" | "daytona" | "modal";
      const timeout = params.timeout ?? getDefaultTimeout();

      // Load template if specified
      let templateData: { image?: string; env_vars?: Record<string, string>; setup_script?: string | null } = {};
      if (params.template_id) {
        const tmpl = getTemplate(params.template_id);
        templateData = { image: tmpl.image ?? undefined, env_vars: tmpl.env_vars, setup_script: tmpl.setup_script };
      }

      const rawImage = params.image ?? templateData.image;
      const resolvedImage = rawImage ? resolveImage(rawImage) : rawImage;
      const builtinSetupScript = rawImage ? getBuiltinImageSetupScript(rawImage) : undefined;
      const envVars = { ...templateData.env_vars, ...params.env_vars };
      const onTimeout = params.on_timeout ?? 'terminate';
      const autoResume = params.auto_resume ?? false;

      const sandbox = createSandbox({
        provider: providerName,
        image: resolvedImage,
        timeout,
        name: params.name,
        env_vars: envVars,
        on_timeout: onTimeout,
        auto_resume: autoResume,
        template_id: params.template_id,
        config: { network: params.network ?? 'full' },
        budget_limit_usd: params.budget_limit_usd,
        on_budget_exceeded: params.on_budget_exceeded,
      });
      sandboxId = sandbox.id;

      const provider = await getProvider(providerName);

      // If restoring from snapshot, resume instead of creating
      if (params.snapshot_id) {
        const snapshot = getSnapshot(params.snapshot_id);
        await provider.resume(snapshot.provider_sandbox_id);
        const updated = updateSandbox(sandbox.id, {
          provider_sandbox_id: snapshot.provider_sandbox_id,
          status: 'running',
        });
        emitLifecycleEvent(sandbox.id, `Sandbox restored from snapshot ${snapshot.id}`);
        return ok(updated);
      }

      const result = await provider.create({
        image: resolvedImage,
        timeout,
        envVars,
        onTimeout,
        autoResume,
      });

      const updated = updateSandbox(sandbox.id, {
        provider_sandbox_id: result.id,
        status: "running",
        started_at: new Date().toISOString(),
      });

      emitLifecycleEvent(sandbox.id, "sandbox created");

      // Run template setup script if provided
      if (templateData.setup_script && result.id) {
        try {
          await provider.exec(result.id, templateData.setup_script);
        } catch {
          // Non-fatal — sandbox is running, setup script failed
        }
      }

      // Run builtin image setup script if applicable
      if (builtinSetupScript && result.id) {
        try {
          await provider.exec(result.id, builtinSetupScript);
        } catch {
          // Non-fatal — sandbox is running, builtin setup script failed
        }
      }

      return ok(updated);
    } catch (e) {
      if (sandboxId) {
        finalizeSandboxProvisionFailure(sandboxId, e);
      }
      return err(e);
    }
  },
);

// 2. get_sandbox
server.tool(
  "get_sandbox",
  "Get sandbox details by ID",
  {
    id: z.string().describe("Sandbox ID or partial ID"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.id);
      const cost = estimateCost(sandbox.provider, sandbox.started_at);
      return ok({ ...sandbox, ...cost });
    } catch (e) {
      return err(e);
    }
  },
);

// 3. list_sandboxes
server.tool(
  "list_sandboxes",
  "List sandboxes with filters",
  {
    status: z.string().optional().describe("Filter by status"),
    provider: z.string().optional().describe("Filter by provider"),
  },
  async (params) => {
    try {
      const sandboxes = listSandboxes({
        status: params.status as any,
        provider: params.provider as any,
      });
      return ok(sandboxes.map((s) => ({ ...s, ...estimateCost(s.provider, s.started_at) })));
    } catch (e) {
      return err(e);
    }
  },
);

// 4. delete_sandbox
server.tool(
  "delete_sandbox",
  "Delete a sandbox",
  {
    id: z.string().describe("Sandbox ID or partial ID"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.id);
      if (sandbox.provider_sandbox_id) {
        const provider = await getProvider(sandbox.provider);
        await provider.delete(sandbox.provider_sandbox_id);
      }
      deleteSandboxDb(sandbox.id);
      emitLifecycleEvent(sandbox.id, "sandbox deleted");
      return ok({ deleted: sandbox.id });
    } catch (e) {
      return err(e);
    }
  },
);

// 5. stop_sandbox
server.tool(
  "stop_sandbox",
  "Stop a running sandbox",
  {
    id: z.string().describe("Sandbox ID or partial ID"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      await provider.stop(sandbox.provider_sandbox_id);
      const updated = updateSandbox(sandbox.id, { status: "stopped" });
      emitLifecycleEvent(sandbox.id, "sandbox stopped");
      return ok(updated);
    } catch (e) {
      return err(e);
    }
  },
);

// 6. keep_alive
server.tool(
  "keep_alive",
  "Extend sandbox lifetime",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
    duration_seconds: z.number().optional().describe("Duration in seconds (default 300)"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      const durationMs = (params.duration_seconds ?? 300) * 1000;
      await provider.keepAlive(sandbox.provider_sandbox_id, durationMs);
      return ok({ kept_alive: sandbox.id, duration_seconds: params.duration_seconds ?? 300 });
    } catch (e) {
      return err(e);
    }
  },
);

// 7. exec_command
server.tool(
  "exec_command",
  "Execute a command in a sandbox",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
    command: z.string().describe("Command to execute"),
    background: z.boolean().optional().describe("Run in background"),
    env_vars: z.record(z.string()).optional().describe("Per-call environment variables (merged with sandbox env_vars, not persisted)"),
    stdin: z.string().optional().describe("String to pipe as stdin to the command"),
    tty: z.boolean().optional().describe("Allocate a TTY for the session (best-effort)"),
  },
  async (params) => {
    let sessionId: string | undefined;
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");

      const session = createSession({
        sandbox_id: sandbox.id,
        command: params.command,
      });
      sessionId = session.id;

      const collector = createStreamCollector(sandbox.id, session.id);
      const provider = await getProvider(sandbox.provider);
      const callEnv = { ...sandbox.env_vars, ...params.env_vars };
      const env = Object.keys(callEnv).length > 0 ? callEnv : undefined;

      // Heredoc fix: commands containing << are passed through bash to support heredoc syntax
      const needsShell = /<<\s*['"]?[A-Z]+['"]?/.test(params.command);
      const effectiveCommand = needsShell ? `bash -c ${JSON.stringify(params.command)}` : params.command;

      if (params.background) {
        // Run without background:true so E2B fires onStdout/onStderr callbacks,
        // but detach the promise so we return immediately.
        provider.exec(sandbox.provider_sandbox_id, effectiveCommand, {
          onStdout: collector.onStdout,
          onStderr: collector.onStderr,
          env,
          stdin: params.stdin,
          tty: params.tty,
        }).then((res) => {
          const r = res as ExecResult;
          finalizeSessionExit(session.id, r.exit_code ?? 0);
        }).catch(() => {
          finalizeSessionFailure(session.id);
        });
        return ok({
          session_id: session.id,
          background: true,
          message: "Command started in background. Use get_session to check completion status and exit_code. Use bg_wait_session to block until done.",
        });
      }

      const result = await provider.exec(sandbox.provider_sandbox_id, effectiveCommand, {
        onStdout: collector.onStdout,
        onStderr: collector.onStderr,
        env,
        stdin: params.stdin,
        tty: params.tty,
      });

      const execResult = result as ExecResult;
      finalizeSessionExit(session.id, execResult.exit_code);
      return ok({
        session_id: session.id,
        exit_code: execResult.exit_code,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      });
    } catch (e) {
      if (sessionId) {
        finalizeSessionFailure(sessionId, e);
      }
      return err(e);
    }
  },
);

// 8. read_file
server.tool(
  "read_file",
  "Read a file from a sandbox",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
    path: z.string().describe("File path"),
    offset: z.number().optional().describe("Line or byte offset to start reading from"),
    limit: z.number().optional().describe("Max lines or bytes to return"),
    encoding: z.enum(['utf8', 'base64', 'hex']).optional().describe("Output encoding (default: utf8)"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      const content = await provider.readFile(sandbox.provider_sandbox_id, params.path, {
        encoding: params.encoding,
        offset: params.offset,
        limit: params.limit,
      });
      return ok({ path: params.path, content, encoding: params.encoding ?? 'utf8' });
    } catch (e) {
      return err(e);
    }
  },
);

// 9. write_file
server.tool(
  "write_file",
  "Write a file to a sandbox",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
    path: z.string().describe("File path"),
    content: z.string().describe("File content"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      await provider.writeFile(sandbox.provider_sandbox_id, params.path, params.content);
      return ok({ path: params.path, written: true });
    } catch (e) {
      return err(e);
    }
  },
);

// 10. list_files
server.tool(
  "list_files",
  "List files in a sandbox directory",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
    path: z.string().describe("Directory path"),
    recursive: z.boolean().optional().describe("List files recursively"),
    glob: z.string().optional().describe("Glob pattern to filter files"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      const files = await provider.listFiles(sandbox.provider_sandbox_id, params.path, {
        recursive: params.recursive,
        glob: params.glob,
      });
      return ok(files);
    } catch (e) {
      return err(e);
    }
  },
);

// 11. get_session
server.tool(
  "get_session",
  "Get session details and exit code (useful for polling background command results)",
  {
    session_id: z.string().describe("Session ID"),
  },
  async (params) => {
    try {
      const session = getSession(params.session_id);
      return ok(session);
    } catch (e) {
      return err(e);
    }
  },
);

// 11b. bg_wait_session
server.tool(
  "bg_wait_session",
  "Wait (poll) for a background command session to complete. Returns exit_code, stdout, stderr when done. Use after exec_command with background:true.",
  {
    session_id: z.string().describe("Session ID from exec_command background:true response"),
    timeout_seconds: z.number().optional().describe("Max seconds to wait (default: 300)"),
    poll_interval_ms: z.number().optional().describe("Poll interval in ms (default: 1000)"),
  },
  async (params) => {
    try {
      const timeoutMs = (params.timeout_seconds ?? 300) * 1000;
      const pollMs = params.poll_interval_ms ?? 1000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const session = getSession(params.session_id);
        if (session.status === "completed" || session.status === "failed" || session.status === "killed") {
          const events = listEvents({ session_id: session.id, limit: 10000 });
          const stdout = events.filter((e) => e.type === "stdout").map((e) => e.data).join("");
          const stderr = events.filter((e) => e.type === "stderr").map((e) => e.data).join("");
          return ok({
            session_id: session.id,
            status: session.status,
            exit_code: session.exit_code ?? ((session.status === "failed" || session.status === "killed") ? 1 : 0),
            stdout,
            stderr,
          });
        }
        // Poll delay
        await new Promise<void>((r) => setTimeout(r, pollMs));
      }
      return err(`Session ${params.session_id} did not complete within ${params.timeout_seconds ?? 300}s`);
    } catch (e) {
      return err(e);
    }
  },
);

// 12. get_logs
server.tool(
  "get_logs",
  "Get sandbox/session event logs",
  {
    sandbox_id: z.string().optional().describe("Filter by sandbox ID"),
    session_id: z.string().optional().describe("Filter by session ID"),
    limit: z.number().optional().describe("Max events to return"),
  },
  async (params) => {
    try {
      return ok(
        listEvents({
          sandbox_id: params.sandbox_id,
          session_id: params.session_id,
          limit: params.limit,
        }),
      );
    } catch (e) {
      return err(e);
    }
  },
);

// 12. register_agent
server.tool(
  "register_agent",
  "Register an agent",
  {
    name: z.string().describe("Agent name"),
    description: z.string().optional().describe("Agent description"),
  },
  async (params) => {
    try {
      return ok(registerAgent({ name: params.name, description: params.description }));
    } catch (e) {
      return err(e);
    }
  },
);

// 13. list_agents
server.tool(
  "list_agents",
  "List all registered agents",
  {},
  async () => {
    try {
      return ok(listAgents());
    } catch (e) {
      return err(e);
    }
  },
);

// 14. register_project
server.tool(
  "register_project",
  "Register a project",
  {
    name: z.string().describe("Project name"),
    path: z.string().describe("Project path"),
    description: z.string().optional().describe("Project description"),
  },
  async (params) => {
    try {
      return ok(ensureProject(params.name, params.path, params.description));
    } catch (e) {
      return err(e);
    }
  },
);

// 15. list_projects
server.tool(
  "list_projects",
  "List all projects",
  {},
  async () => {
    try {
      return ok(listProjects());
    } catch (e) {
      return err(e);
    }
  },
);

// 16. describe_tools
server.tool(
  "describe_tools",
  "List all available tools",
  {},
  async () => {
    try {
      return ok(TOOL_CATALOG);
    } catch (e) {
      return err(e);
    }
  },
);

// 17. search_tools
server.tool(
  "search_tools",
  "Search tools by keyword",
  {
    query: z.string().describe("Search query"),
  },
  async (params) => {
    try {
      const q = params.query.toLowerCase();
      const matches = TOOL_CATALOG.filter(
        (t) => t.name.includes(q) || t.description.toLowerCase().includes(q),
      );
      return ok(matches);
    } catch (e) {
      return err(e);
    }
  },
);

// 18. run_agent
server.tool(
  "run_agent",
  "Run an AI agent inside a sandbox",
  {
    sandbox_id: z.string().describe("Sandbox ID"),
    agent_type: z.enum(["claude", "codex", "gemini", "opencode", "pi", "custom"]).describe("Agent type"),
    prompt: z.string().describe("Prompt for the agent"),
    agent_name: z.string().optional().describe("Agent name"),
    command: z.string().optional().describe("Custom command (for 'custom' type)"),
    env_vars: z.record(z.string()).optional().describe("Per-call environment variables (merged with sandbox env_vars, not persisted)"),
    webhook_url: z.string().optional().describe("URL to POST result to when agent finishes"),
    webhook_events: z.array(z.enum(['start', 'complete', 'error'])).optional().describe("Which events to notify on (default: all)"),
  },
  async (params) => {
    try {
      const session = await runAgentLib(params.sandbox_id, {
        agentType: params.agent_type as AgentType,
        prompt: params.prompt,
        agentName: params.agent_name,
        command: params.command,
        callEnvVars: params.env_vars,
        webhookUrl: params.webhook_url,
        webhookEvents: params.webhook_events,
      });
      return ok({ session_id: session.id, status: session.status });
    } catch (e) {
      return err(e);
    }
  },
);

// 19. stop_agent
server.tool(
  "stop_agent",
  "Stop a running agent in a sandbox",
  {
    sandbox_id: z.string().describe("Sandbox ID"),
  },
  async (params) => {
    try {
      await stopAgentLib(params.sandbox_id);
      return ok({ stopped: true });
    } catch (e) {
      return err(e);
    }
  },
);

// 20. get_agent_output
server.tool(
  "get_agent_output",
  "Get output from an agent session",
  {
    sandbox_id: z.string().describe("Sandbox ID"),
    session_id: z.string().optional().describe("Session ID"),
    limit: z.number().optional().describe("Max events"),
    offset: z.number().optional().describe("Skip first N events (for incremental polling)"),
  },
  async (params) => {
    try {
      const events = listEvents({
        sandbox_id: params.sandbox_id,
        session_id: params.session_id,
        limit: params.limit || 100,
        offset: params.offset,
      });
      const stdout = events
        .filter((e) => e.type === "stdout")
        .map((e) => e.data)
        .join("");
      const stderr = events
        .filter((e) => e.type === "stderr")
        .map((e) => e.data)
        .join("");
      return ok({ stdout, stderr, event_count: events.length, next_offset: (params.offset ?? 0) + events.length });
    } catch (e) {
      return err(e);
    }
  },
);

// 21. pause_sandbox
server.tool(
  "pause_sandbox",
  "Pause a running sandbox, saving its state for later resume",
  {
    id: z.string().describe("Sandbox ID or partial ID"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      await provider.pause(sandbox.provider_sandbox_id);
      const updated = updateSandbox(sandbox.id, { status: "paused" });
      emitLifecycleEvent(sandbox.id, "sandbox paused");
      return ok(updated);
    } catch (e) { return err(e); }
  },
);

// 22. resume_sandbox
server.tool(
  "resume_sandbox",
  "Resume a paused sandbox",
  {
    id: z.string().describe("Sandbox ID or partial ID"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      await provider.resume(sandbox.provider_sandbox_id);
      const updated = updateSandbox(sandbox.id, { status: "running" });
      emitLifecycleEvent(sandbox.id, "sandbox resumed");
      return ok(updated);
    } catch (e) { return err(e); }
  },
);

// 23. create_template
server.tool(
  "create_template",
  "Create a reusable sandbox template",
  {
    name: z.string().describe("Template name"),
    description: z.string().optional(),
    image: z.string().optional().describe("Container image"),
    env_vars: z.record(z.string()).optional().describe("Environment variables"),
    setup_script: z.string().optional().describe("Shell script to run on sandbox creation"),
    tags: z.array(z.string()).optional(),
  },
  async (params) => {
    try { return ok(createTemplate(params)); } catch (e) { return err(e); }
  },
);

// 24. list_templates
server.tool(
  "list_templates",
  "List all sandbox templates",
  {},
  async () => {
    try { return ok(listTemplates()); } catch (e) { return err(e); }
  },
);

// 25. get_template
server.tool(
  "get_template",
  "Get a sandbox template by ID",
  {
    id: z.string().describe("Template ID or partial ID"),
  },
  async (params) => {
    try { return ok(getTemplate(params.id)); } catch (e) { return err(e); }
  },
);

// 26. delete_template
server.tool(
  "delete_template",
  "Delete a sandbox template",
  {
    id: z.string().describe("Template ID or partial ID"),
  },
  async (params) => {
    try {
      deleteTemplate(params.id);
      return ok({ deleted: params.id });
    } catch (e) { return err(e); }
  },
);

// 27. get_sandbox_status
server.tool(
  "get_sandbox_status",
  "Get running processes, disk usage and uptime in a sandbox",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);

      // Run status commands concurrently
      const [psResult, dfResult, uptimeResult] = (await Promise.all([
        provider.exec(sandbox.provider_sandbox_id, "ps aux --no-headers 2>/dev/null | head -30 || ps aux 2>/dev/null | tail -n +2 | head -30"),
        provider.exec(sandbox.provider_sandbox_id, "df -h / 2>/dev/null || df -h 2>/dev/null | head -5"),
        provider.exec(sandbox.provider_sandbox_id, "uptime 2>/dev/null || echo unknown"),
      ])) as ExecResult[];

      // Parse ps output into structured list
      const processes = ((psResult as ExecResult).stdout || "").trim().split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            pid: parts[1] || "",
            cpu: parts[2] || "0",
            mem: parts[3] || "0",
            command: parts.slice(10).join(" ") || parts.slice(4).join(" "),
          };
        });

      return ok({
        sandbox_id: sandbox.id,
        status: sandbox.status,
        processes,
        disk: ((dfResult as ExecResult).stdout || "").trim(),
        uptime: ((uptimeResult as ExecResult).stdout || "").trim(),
      });
    } catch (e) {
      return err(e);
    }
  },
);

// 28. snapshot_sandbox
server.tool(
  "snapshot_sandbox",
  "Capture sandbox filesystem state as a snapshot",
  {
    id: z.string().describe("Sandbox ID or partial ID"),
    name: z.string().optional().describe("Snapshot name"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      await provider.pause(sandbox.provider_sandbox_id);
      updateSandbox(sandbox.id, { status: 'paused' });
      const snapshot = createSnapshot({
        sandbox_id: sandbox.id,
        provider_sandbox_id: sandbox.provider_sandbox_id,
        provider: sandbox.provider,
        name: params.name,
      });
      emitLifecycleEvent(sandbox.id, `Snapshot created: ${snapshot.id}`);
      return ok(snapshot);
    } catch (e) { return err(e); }
  },
);

// 29. list_snapshots
server.tool(
  "list_snapshots",
  "List filesystem snapshots",
  {
    sandbox_id: z.string().optional().describe("Filter by sandbox ID"),
  },
  async (params) => {
    try { return ok(listSnapshots(params.sandbox_id)); } catch (e) { return err(e); }
  },
);

// 30. delete_snapshot
server.tool(
  "delete_snapshot",
  "Delete a snapshot",
  {
    id: z.string().describe("Snapshot ID or partial ID"),
  },
  async (params) => {
    try {
      deleteSnapshot(params.id);
      return ok({ deleted: params.id });
    } catch (e) { return err(e); }
  },
);

// 31. expose_port
server.tool(
  "expose_port",
  "Forward a sandbox port and get a public URL",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
    port: z.number().describe("Port number to expose"),
    protocol: z.string().optional().describe("Protocol: http or ws (default: http)"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      const url = await provider.getPublicUrl(sandbox.provider_sandbox_id, params.port, params.protocol);
      if (!exposedPorts.has(sandbox.id)) exposedPorts.set(sandbox.id, new Map());
      exposedPorts.get(sandbox.id)!.set(params.port, url);
      return ok({ sandbox_id: sandbox.id, port: params.port, url });
    } catch (e) { return err(e); }
  },
);

// 32. list_exposed_ports
server.tool(
  "list_exposed_ports",
  "List all forwarded ports for a sandbox",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      const ports = exposedPorts.get(sandbox.id) ?? new Map();
      const result = Array.from(ports.entries()).map(([port, url]) => ({ port, url }));
      return ok(result);
    } catch (e) { return err(e); }
  },
);

// 33. close_port
server.tool(
  "close_port",
  "Stop forwarding a sandbox port",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
    port: z.number().describe("Port number to close"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      exposedPorts.get(sandbox.id)?.delete(params.port);
      return ok({ sandbox_id: sandbox.id, port: params.port, closed: true });
    } catch (e) { return err(e); }
  },
);

// 34. get_network_log
server.tool(
  "get_network_log",
  "Get outbound network connections from a sandbox",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      const result = await provider.exec(
        sandbox.provider_sandbox_id,
        "ss -tnp 2>/dev/null || netstat -tnp 2>/dev/null || echo 'Network log not available'"
      ) as ExecResult;
      return ok({ sandbox_id: sandbox.id, connections: (result.stdout || "").trim() });
    } catch (e) { return err(e); }
  },
);

// 35. watch_file
server.tool(
  "watch_file",
  "Get new content from a file since a previous read (tail -f equivalent)",
  {
    sandbox_id: z.string().describe("Sandbox ID or partial ID"),
    path: z.string().describe("File path to watch"),
    offset: z.number().optional().describe("Line offset to read from (use next_offset from previous call)"),
    limit: z.number().optional().describe("Max lines to return (default: 100)"),
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      const content = await provider.readFile(sandbox.provider_sandbox_id, params.path, {
        offset: params.offset,
        limit: params.limit ?? 100,
      });
      const lines = content.split('\n');
      return ok({
        path: params.path,
        content,
        lines_read: lines.length,
        next_offset: (params.offset ?? 0) + lines.length,
      });
    } catch (e) { return err(e); }
  },
);

// 36. list_images
server.tool(
  "list_images",
  "List available pre-warmed sandbox image aliases",
  {},
  async () => {
    try {
      return ok(Object.entries(BUILTIN_IMAGES).map(([name, info]) => ({
        name,
        description: info.description,
        has_setup_script: !!info.setup_script,
      })));
    } catch (e) { return err(e); }
  },
);

// ── Start ────────────────────────────────────────────────────────────


const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string }>();

server.tool(
  "register_agent",
  "Register this agent session. Returns agent_id for use in heartbeat/set_focus.",
  { name: z.string(), session_id: z.string().optional() },
  async (a: { name: string; session_id?: string }) => {
    const existing = [..._agentReg.values()].find(x => x.name === a.name);
    if (existing) { existing.last_seen_at = new Date().toISOString(); return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] }; }
    const id = Math.random().toString(36).slice(2, 10);
    const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
    _agentReg.set(id, ag);
    return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
  }
);

server.tool(
  "heartbeat",
  "Update last_seen_at to signal agent is active.",
  { agent_id: z.string() },
  async (a: { agent_id: string }) => {
    const ag = _agentReg.get(a.agent_id);
    if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
    ag.last_seen_at = new Date().toISOString();
    return { content: [{ type: "text" as const, text: `♥ ${ag.name} — active` }] };
  }
);

server.tool(
  "set_focus",
  "Set active project context for this agent session.",
  { agent_id: z.string(), project_id: z.string().optional() },
  async (a: { agent_id: string; project_id?: string }) => {
    const ag = _agentReg.get(a.agent_id);
    if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
    (ag as any).project_id = a.project_id;
    return { content: [{ type: "text" as const, text: a.project_id ? `Focus: ${a.project_id}` : "Focus cleared" }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
