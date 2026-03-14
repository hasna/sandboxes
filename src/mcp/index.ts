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
import { createSession, endSession } from "../db/sessions.js";
import { listEvents } from "../db/events.js";
import { registerAgent, listAgents } from "../db/agents.js";
import {
  listProjects,
  ensureProject,
} from "../db/projects.js";
import { getProvider } from "../providers/index.js";
import { getDefaultProvider, getDefaultTimeout } from "../lib/config.js";
import { createStreamCollector, emitLifecycleEvent } from "../lib/stream.js";
import { runAgent as runAgentLib, stopAgent as stopAgentLib } from "../lib/agent-runner.js";
import type { ExecResult, AgentType } from "../types/index.js";

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
  { name: "get_logs", description: "Get sandbox/session event logs" },
  { name: "register_agent", description: "Register an agent" },
  { name: "list_agents", description: "List all registered agents" },
  { name: "register_project", description: "Register a project" },
  { name: "list_projects", description: "List all projects" },
  { name: "describe_tools", description: "List all available tools" },
  { name: "search_tools", description: "Search tools by keyword" },
];

// ── Server ───────────────────────────────────────────────────────────

const server = new McpServer({
  name: "sandboxes",
  version: "0.1.0",
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
  },
  async (params) => {
    try {
      const providerName = (params.provider ?? getDefaultProvider()) as "e2b" | "daytona" | "modal";
      const timeout = params.timeout ?? getDefaultTimeout();

      const sandbox = createSandbox({
        provider: providerName,
        image: params.image,
        timeout,
        name: params.name,
        env_vars: params.env_vars,
      });

      const provider = await getProvider(providerName);
      const result = await provider.create({
        image: params.image,
        timeout,
        envVars: params.env_vars,
      });

      const updated = updateSandbox(sandbox.id, {
        provider_sandbox_id: result.id,
        status: "running",
      });

      emitLifecycleEvent(sandbox.id, "sandbox created");
      return ok(updated);
    } catch (e) {
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
      return ok(getSandbox(params.id));
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
      return ok(
        listSandboxes({
          status: params.status as any,
          provider: params.provider as any,
        }),
      );
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
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");

      const session = createSession({
        sandbox_id: sandbox.id,
        command: params.command,
      });

      const collector = createStreamCollector(sandbox.id, session.id);
      const provider = await getProvider(sandbox.provider);
      const env = Object.keys(sandbox.env_vars ?? {}).length > 0 ? sandbox.env_vars : undefined;

      if (params.background) {
        // Run without background:true so E2B fires onStdout/onStderr callbacks,
        // but detach the promise so we return immediately.
        provider.exec(sandbox.provider_sandbox_id, params.command, {
          onStdout: collector.onStdout,
          onStderr: collector.onStderr,
          env,
        }).then((res) => {
          const r = res as ExecResult;
          endSession(session.id, r.exit_code ?? 0);
        }).catch(() => {
          endSession(session.id, 1);
        });
        return ok({ session_id: session.id, background: true });
      }

      const result = await provider.exec(sandbox.provider_sandbox_id, params.command, {
        onStdout: collector.onStdout,
        onStderr: collector.onStderr,
        env,
      });

      const execResult = result as ExecResult;
      endSession(session.id, execResult.exit_code);
      return ok({
        session_id: session.id,
        exit_code: execResult.exit_code,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
      });
    } catch (e) {
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
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      const content = await provider.readFile(sandbox.provider_sandbox_id, params.path);
      return ok({ path: params.path, content });
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
  },
  async (params) => {
    try {
      const sandbox = getSandbox(params.sandbox_id);
      if (!sandbox.provider_sandbox_id) throw new Error("Sandbox has no provider ID");
      const provider = await getProvider(sandbox.provider);
      const files = await provider.listFiles(sandbox.provider_sandbox_id, params.path);
      return ok(files);
    } catch (e) {
      return err(e);
    }
  },
);

// 11. get_logs
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
      const project = ensureProject(params.name, params.path);
      return ok(project);
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
    agent_type: z.enum(["claude", "codex", "gemini", "custom"]).describe("Agent type"),
    prompt: z.string().describe("Prompt for the agent"),
    agent_name: z.string().optional().describe("Agent name"),
    command: z.string().optional().describe("Custom command (for 'custom' type)"),
  },
  async (params) => {
    try {
      const session = await runAgentLib(params.sandbox_id, {
        agentType: params.agent_type as AgentType,
        prompt: params.prompt,
        agentName: params.agent_name,
        command: params.command,
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
  },
  async (params) => {
    try {
      const events = listEvents({
        sandbox_id: params.sandbox_id,
        session_id: params.session_id,
        limit: params.limit || 100,
      });
      const stdout = events
        .filter((e) => e.type === "stdout")
        .map((e) => e.data)
        .join("");
      const stderr = events
        .filter((e) => e.type === "stderr")
        .map((e) => e.data)
        .join("");
      return ok({ stdout, stderr, event_count: events.length });
    } catch (e) {
      return err(e);
    }
  },
);

// ── Start ────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
