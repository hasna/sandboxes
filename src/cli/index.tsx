#!/usr/bin/env bun

import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "node:child_process";

import {
  createSandbox,
  getSandbox,
  listSandboxes,
  updateSandbox,
  deleteSandbox,
} from "../db/sandboxes.js";
import {
  createSession,
  endSession,
} from "../db/sessions.js";
import { listEvents } from "../db/events.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { getProvider } from "../providers/index.js";
import {
  setConfigValue,
  getConfigValue,
  getDefaultProvider,
  getDefaultTimeout,
  getDefaultImage,
} from "../lib/config.js";
import { createStreamCollector } from "../lib/stream.js";
import type { SandboxProviderName } from "../types/index.js";

// ── Helpers ──────────────────────────────────────────────────────────

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || "").length))
  );

  const headerLine = headers
    .map((h, i) => chalk.bold(h.padEnd(widths[i]!)))
    .join("  ");
  const separator = widths.map((w) => "─".repeat(w)).join("──");

  console.log(headerLine);
  console.log(chalk.dim(separator));
  for (const row of rows) {
    console.log(row.map((c, i) => (c || "").padEnd(widths[i]!)).join("  "));
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "running":
      return chalk.green(status);
    case "creating":
      return chalk.yellow(status);
    case "paused":
      return chalk.blue(status);
    case "stopped":
      return chalk.gray(status);
    case "deleted":
      return chalk.dim(status);
    case "error":
      return chalk.red(status);
    default:
      return status;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function handleError(err: unknown): never {
  if (err instanceof Error) {
    console.error(chalk.red(`Error: ${err.message}`));
  } else {
    console.error(chalk.red("An unknown error occurred"));
  }
  process.exit(1);
}

function parseEnvVars(envArgs: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const arg of envArgs) {
    const idx = arg.indexOf("=");
    if (idx === -1) {
      console.error(chalk.red(`Invalid env var format: ${arg} (expected KEY=VALUE)`));
      process.exit(1);
    }
    vars[arg.slice(0, idx)] = arg.slice(idx + 1);
  }
  return vars;
}

// ── Program ──────────────────────────────────────────────────────────

const program = new Command()
  .name("sandboxes")
  .description("Universal cloud sandbox manager for AI coding agents")
  .version("0.1.0");

// ── create ───────────────────────────────────────────────────────────

program
  .command("create")
  .description("Create a new sandbox")
  .option("-p, --provider <provider>", "Provider (e2b, daytona, modal)")
  .option("-i, --image <image>", "Container image")
  .option("-t, --timeout <seconds>", "Timeout in seconds")
  .option("-n, --name <name>", "Sandbox name")
  .option("-e, --env <KEY=VAL...>", "Environment variables", (val: string, acc: string[]) => {
    acc.push(val);
    return acc;
  }, [] as string[])
  .action(async (opts) => {
    try {
      const provider = (opts.provider || getDefaultProvider()) as SandboxProviderName;
      const timeout = opts.timeout ? parseInt(opts.timeout, 10) : getDefaultTimeout();
      const image = opts.image || getDefaultImage();
      const envVars = opts.env.length > 0 ? parseEnvVars(opts.env) : undefined;

      const sandbox = createSandbox({
        provider,
        name: opts.name,
        image,
        timeout,
        env_vars: envVars,
      });

      console.log(chalk.dim("Creating sandbox..."));

      const p = await getProvider(provider);
      const result = await p.create({
        image: sandbox.image || undefined,
        timeout: sandbox.timeout,
        envVars: sandbox.env_vars,
      });

      const updated = updateSandbox(sandbox.id, {
        provider_sandbox_id: result.id,
        status: "running",
      });

      console.log(chalk.green("Sandbox created"));
      console.log(`  ${chalk.bold("ID:")}       ${updated.id}`);
      console.log(`  ${chalk.bold("Provider:")} ${updated.provider}`);
      console.log(`  ${chalk.bold("Status:")}   ${statusColor(updated.status)}`);
      if (updated.name) {
        console.log(`  ${chalk.bold("Name:")}     ${updated.name}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── list ─────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List sandboxes")
  .option("-s, --status <status>", "Filter by status")
  .option("-p, --provider <provider>", "Filter by provider")
  .option("--json", "Output as JSON")
  .action((opts) => {
    try {
      const sandboxes = listSandboxes({
        status: opts.status,
        provider: opts.provider,
      });

      if (opts.json) {
        console.log(JSON.stringify(sandboxes, null, 2));
        return;
      }

      if (sandboxes.length === 0) {
        console.log(chalk.dim("No sandboxes found."));
        return;
      }

      printTable(
        ["ID", "NAME", "PROVIDER", "STATUS", "IMAGE", "CREATED"],
        sandboxes.map((s) => [
          shortId(s.id),
          s.name || chalk.dim("—"),
          s.provider,
          statusColor(s.status),
          s.image || chalk.dim("default"),
          new Date(s.created_at).toLocaleString(),
        ])
      );
    } catch (err) {
      handleError(err);
    }
  });

// ── show ─────────────────────────────────────────────────────────────

program
  .command("show <id>")
  .description("Show sandbox details")
  .action((id) => {
    try {
      const sandbox = getSandbox(id);

      console.log(chalk.bold("Sandbox Details"));
      console.log(`  ${chalk.bold("ID:")}                ${sandbox.id}`);
      console.log(`  ${chalk.bold("Provider:")}          ${sandbox.provider}`);
      console.log(`  ${chalk.bold("Provider Sandbox:")}  ${sandbox.provider_sandbox_id || chalk.dim("none")}`);
      console.log(`  ${chalk.bold("Name:")}              ${sandbox.name || chalk.dim("none")}`);
      console.log(`  ${chalk.bold("Status:")}            ${statusColor(sandbox.status)}`);
      console.log(`  ${chalk.bold("Image:")}             ${sandbox.image || chalk.dim("default")}`);
      console.log(`  ${chalk.bold("Timeout:")}           ${sandbox.timeout}s`);
      console.log(`  ${chalk.bold("Created:")}           ${sandbox.created_at}`);
      console.log(`  ${chalk.bold("Updated:")}           ${sandbox.updated_at}`);

      if (Object.keys(sandbox.env_vars).length > 0) {
        console.log(`  ${chalk.bold("Env Vars:")}`);
        for (const [k, v] of Object.entries(sandbox.env_vars)) {
          console.log(`    ${k}=${v}`);
        }
      }

      if (Object.keys(sandbox.config).length > 0) {
        console.log(`  ${chalk.bold("Config:")}           ${JSON.stringify(sandbox.config)}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── exec ─────────────────────────────────────────────────────────────

program
  .command("exec <id> <command...>")
  .description("Execute a command in a sandbox")
  .action(async (id, commandParts) => {
    try {
      const sandbox = getSandbox(id);

      if (!sandbox.provider_sandbox_id) {
        console.error(chalk.red("Sandbox has no provider ID — it may not have been created yet."));
        process.exit(1);
      }

      const cmd = commandParts.join(" ");
      const session = createSession({
        sandbox_id: sandbox.id,
        command: cmd,
      });

      const collector = createStreamCollector(sandbox.id, session.id);

      const p = await getProvider(sandbox.provider);
      const result = await p.exec(sandbox.provider_sandbox_id, cmd, {
        onStdout: (data) => {
          process.stdout.write(data);
          collector.onStdout(data);
        },
        onStderr: (data) => {
          process.stderr.write(data);
          collector.onStderr(data);
        },
      });

      // ExecResult (not ExecHandle) — has exit_code directly
      const execResult = "exit_code" in result ? result : await result.wait();

      endSession(
        session.id,
        execResult.exit_code,
        execResult.exit_code === 0 ? "completed" : "failed"
      );

      process.exit(execResult.exit_code);
    } catch (err) {
      handleError(err);
    }
  });

// ── stop ─────────────────────────────────────────────────────────────

program
  .command("stop <id>")
  .description("Stop a sandbox")
  .action(async (id) => {
    try {
      const sandbox = getSandbox(id);

      if (sandbox.provider_sandbox_id) {
        const p = await getProvider(sandbox.provider);
        await p.stop(sandbox.provider_sandbox_id);
      }

      updateSandbox(sandbox.id, { status: "stopped" });
      console.log(chalk.green(`Sandbox ${shortId(sandbox.id)} stopped.`));
    } catch (err) {
      handleError(err);
    }
  });

// ── delete ───────────────────────────────────────────────────────────

program
  .command("delete <id>")
  .description("Delete a sandbox")
  .action(async (id) => {
    try {
      const sandbox = getSandbox(id);

      if (sandbox.provider_sandbox_id) {
        try {
          const p = await getProvider(sandbox.provider);
          await p.delete(sandbox.provider_sandbox_id);
        } catch {
          // Provider delete may fail if already gone — continue with DB cleanup
        }
      }

      deleteSandbox(sandbox.id);
      console.log(chalk.green(`Sandbox ${shortId(sandbox.id)} deleted.`));
    } catch (err) {
      handleError(err);
    }
  });

// ── logs ─────────────────────────────────────────────────────────────

program
  .command("logs <id>")
  .description("Show event logs for a sandbox")
  .option("-f, --follow", "Follow log output")
  .option("-s, --session <session_id>", "Filter by session ID")
  .option("-l, --limit <n>", "Max number of events", "50")
  .action(async (id, opts) => {
    try {
      const sandbox = getSandbox(id);
      const limit = parseInt(opts.limit, 10);

      const printEvents = (events: ReturnType<typeof listEvents>) => {
        for (const event of events) {
          const time = chalk.dim(new Date(event.created_at).toLocaleTimeString());
          const type =
            event.type === "stderr"
              ? chalk.red(event.type)
              : event.type === "stdout"
                ? chalk.green(event.type)
                : chalk.blue(event.type);
          const data = event.data || "";
          console.log(`${time} ${type} ${data}`);
        }
      };

      const events = listEvents({
        sandbox_id: sandbox.id,
        session_id: opts.session,
        limit,
      });

      printEvents(events);

      if (opts.follow) {
        let lastCount = events.length;
        const poll = setInterval(() => {
          const newEvents = listEvents({
            sandbox_id: sandbox.id,
            session_id: opts.session,
            limit: 100,
            offset: lastCount,
          });
          if (newEvents.length > 0) {
            printEvents(newEvents);
            lastCount += newEvents.length;
          }
        }, 1000);

        process.on("SIGINT", () => {
          clearInterval(poll);
          process.exit(0);
        });
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── files ────────────────────────────────────────────────────────────

const filesCmd = program
  .command("files")
  .description("File operations on a sandbox");

filesCmd
  .command("ls <id> <path>")
  .description("List files in a sandbox directory")
  .action(async (id, path) => {
    try {
      const sandbox = getSandbox(id);
      if (!sandbox.provider_sandbox_id) {
        console.error(chalk.red("Sandbox has no provider ID."));
        process.exit(1);
      }

      const p = await getProvider(sandbox.provider);
      const files = await p.listFiles(sandbox.provider_sandbox_id, path);

      if (files.length === 0) {
        console.log(chalk.dim("No files found."));
        return;
      }

      printTable(
        ["NAME", "TYPE", "SIZE"],
        files.map((f) => [
          f.is_dir ? chalk.blue(f.name + "/") : f.name,
          f.is_dir ? "dir" : "file",
          f.is_dir ? chalk.dim("—") : `${f.size}`,
        ])
      );
    } catch (err) {
      handleError(err);
    }
  });

filesCmd
  .command("read <id> <path>")
  .description("Read a file from a sandbox")
  .action(async (id, path) => {
    try {
      const sandbox = getSandbox(id);
      if (!sandbox.provider_sandbox_id) {
        console.error(chalk.red("Sandbox has no provider ID."));
        process.exit(1);
      }

      const p = await getProvider(sandbox.provider);
      const content = await p.readFile(sandbox.provider_sandbox_id, path);
      process.stdout.write(content);
    } catch (err) {
      handleError(err);
    }
  });

filesCmd
  .command("write <id> <path>")
  .description("Write content to a file in a sandbox")
  .requiredOption("-c, --content <content>", "Content to write")
  .action(async (id, path, opts) => {
    try {
      const sandbox = getSandbox(id);
      if (!sandbox.provider_sandbox_id) {
        console.error(chalk.red("Sandbox has no provider ID."));
        process.exit(1);
      }

      const p = await getProvider(sandbox.provider);
      await p.writeFile(sandbox.provider_sandbox_id, path, opts.content);
      console.log(chalk.green(`Written to ${path}`));
    } catch (err) {
      handleError(err);
    }
  });

// ── agent ────────────────────────────────────────────────────────────

const agentCmd = program
  .command("agent")
  .description("Run and manage AI agents in sandboxes");

agentCmd
  .command("run <id>")
  .description("Run an AI agent inside a sandbox")
  .requiredOption("-t, --type <type>", "Agent type: claude, codex, gemini, custom")
  .requiredOption("-p, --prompt <prompt>", "Prompt for the agent")
  .option("-n, --name <name>", "Agent name")
  .option("-c, --command <cmd>", "Custom command (for 'custom' type)")
  .action(async (id: string, opts: { type: string; prompt: string; name?: string; command?: string }) => {
    try {
      const { runAgent } = await import("../lib/agent-runner.js");
      const session = await runAgent(id, {
        agentType: opts.type as "claude" | "codex" | "gemini" | "custom",
        prompt: opts.prompt,
        agentName: opts.name,
        command: opts.command,
        onStdout: (data: string) => process.stdout.write(data),
        onStderr: (data: string) => process.stderr.write(data),
      });
      console.log(chalk.green(`\nAgent session: ${session.id} (${session.status})`));
    } catch (err) {
      handleError(err);
    }
  });

agentCmd
  .command("stop <id>")
  .description("Stop a running agent in a sandbox")
  .action(async (id: string) => {
    try {
      const { stopAgent } = await import("../lib/agent-runner.js");
      await stopAgent(id);
      console.log(chalk.green("Agent stopped."));
    } catch (err) {
      handleError(err);
    }
  });

agentCmd
  .command("stream <id>")
  .description("Stream agent output from a sandbox")
  .option("-s, --session <session>", "Session ID")
  .action(async (id: string, opts: { session?: string }) => {
    try {
      const sandbox = getSandbox(id);
      const events = listEvents({
        sandbox_id: sandbox.id,
        session_id: opts.session,
      });

      for (const event of events) {
        if (event.type === "stdout" && event.data) {
          process.stdout.write(event.data);
        } else if (event.type === "stderr" && event.data) {
          process.stderr.write(event.data);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── config ───────────────────────────────────────────────────────────

const configCmd = program
  .command("config")
  .description("Configuration management");

configCmd
  .command("set <key> <value>")
  .description("Set a config value")
  .action((key, value) => {
    try {
      setConfigValue(key, value);
      console.log(chalk.green(`Set ${key} = ${value}`));
    } catch (err) {
      handleError(err);
    }
  });

configCmd
  .command("get <key>")
  .description("Get a config value")
  .action((key) => {
    try {
      const value = getConfigValue(key);
      if (value === undefined) {
        console.log(chalk.dim("(not set)"));
      } else {
        console.log(value);
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── init ─────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Register an agent")
  .requiredOption("-n, --name <name>", "Agent name")
  .option("-d, --description <desc>", "Agent description")
  .action((opts) => {
    try {
      const agent = registerAgent({
        name: opts.name,
        description: opts.description,
      });
      console.log(chalk.green(`Agent registered: ${agent.name}`));
      console.log(`  ${chalk.bold("ID:")} ${agent.id}`);
    } catch (err) {
      handleError(err);
    }
  });

// ── agents ───────────────────────────────────────────────────────────

program
  .command("agents")
  .description("List registered agents")
  .action(() => {
    try {
      const agents = listAgents();

      if (agents.length === 0) {
        console.log(chalk.dim("No agents registered."));
        return;
      }

      printTable(
        ["ID", "NAME", "DESCRIPTION", "LAST SEEN"],
        agents.map((a) => [
          shortId(a.id),
          a.name,
          a.description || chalk.dim("—"),
          new Date(a.last_seen_at).toLocaleString(),
        ])
      );
    } catch (err) {
      handleError(err);
    }
  });

// ── mcp ──────────────────────────────────────────────────────────────

program
  .command("mcp")
  .description("Install MCP server for AI agents")
  .option("--claude", "Install for Claude Code (default)")
  .option("--codex", "Install for Codex")
  .option("--gemini", "Install for Gemini")
  .action((opts) => {
    try {
      const targets: string[] = [];

      if (opts.codex) targets.push("codex");
      if (opts.gemini) targets.push("gemini");
      if (opts.claude || targets.length === 0) targets.push("claude");

      for (const target of targets) {
        switch (target) {
          case "claude": {
            const cmd = `claude mcp add --transport stdio --scope user sandboxes -- bunx @hasna/sandboxes sandboxes-mcp`;
            console.log(chalk.dim(`Running: ${cmd}`));
            execSync(cmd, { stdio: "inherit" });
            console.log(chalk.green("Installed MCP server for Claude Code."));
            break;
          }
          case "codex": {
            console.log(chalk.yellow("Codex MCP installation: add the following to ~/.codex/config.toml:"));
            console.log();
            console.log(`[mcp_servers.sandboxes]`);
            console.log(`command = "bunx"`);
            console.log(`args = ["@hasna/sandboxes", "sandboxes-mcp"]`);
            break;
          }
          case "gemini": {
            console.log(chalk.yellow("Gemini MCP installation: add the following to ~/.gemini/settings.json:"));
            console.log();
            console.log(JSON.stringify({
              mcpServers: {
                sandboxes: {
                  command: "bunx",
                  args: ["@hasna/sandboxes", "sandboxes-mcp"],
                },
              },
            }, null, 2));
            break;
          }
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

// ── Parse ────────────────────────────────────────────────────────────

program.parse();
