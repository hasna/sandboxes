#!/usr/bin/env bun

import { Command } from "commander";
import { registerEventsCommands } from "@hasna/events/commander";
import chalk from "chalk";

import {
  createSandbox,
  getSandbox,
  listSandboxes,
  updateSandbox,
  deleteSandbox,
} from "../db/sandboxes.js";
import {
  createSession,
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
import {
  finalizeSandboxProvisionFailure,
  finalizeSessionExit,
  finalizeSessionFailure,
} from "../lib/runtime-state.js";
import { getPackageVersion } from "../lib/version.js";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_LOG_LIMIT,
  keySummary,
  pageItems,
  parseLimit,
  parseNonNegativeInt,
  shortId as compactShortId,
  truncateText,
} from "../lib/compact-output.js";
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

function handleError(err: unknown): never {
  if (err instanceof Error) {
    console.error(chalk.red(`Error: ${err.message}`));
  } else {
    console.error(chalk.red("An unknown error occurred"));
  }
  process.exit(1);
}

function shortId(id: string): string {
  return compactShortId(id);
}

function printPageHint(
  page: { total: number; limit: number; cursor: number; next_cursor: number | null },
  detailHint?: string
): void {
  const rangeStart = page.total === 0 ? 0 : page.cursor + 1;
  const rangeEnd = page.cursor + page.limit > page.total ? page.total : page.cursor + page.limit;
  console.log(chalk.dim(`Showing ${rangeStart}-${rangeEnd} of ${page.total}.`));
  const hints = [];
  if (page.next_cursor !== null) hints.push(`use --cursor ${page.next_cursor} for more`);
  if (detailHint) hints.push(detailHint);
  if (hints.length > 0) console.log(chalk.dim(`Hint: ${hints.join("; ")}.`));
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
  .version(getPackageVersion());

registerEventsCommands(program, { source: "sandboxes" });

// ── create ───────────────────────────────────────────────────────────

program
  .command("create")
  .description("Create a new sandbox")
  .option("-p, --provider <provider>", "Provider (e2b, daytona, modal, kernel)")
  .option("-i, --image <image>", "Container image")
  .option("-t, --timeout <seconds>", "Timeout in seconds")
  .option("-n, --name <name>", "Sandbox name")
  .option("-e, --env <KEY=VAL...>", "Environment variables", (val: string, acc: string[]) => {
    acc.push(val);
    return acc;
  }, [] as string[])
  .action(async (opts) => {
    let sandboxId: string | undefined;
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
      sandboxId = sandbox.id;

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
      if (sandboxId) {
        finalizeSandboxProvisionFailure(sandboxId, err);
      }
      handleError(err);
    }
  });

// ── list ─────────────────────────────────────────────────────────────

program
  .command("list")
  .description("List sandboxes")
  .option("-s, --status <status>", "Filter by status")
  .option("-p, --provider <provider>", "Filter by provider")
  .option("-l, --limit <n>", `Max rows to show (default ${DEFAULT_LIST_LIMIT}, max 200)`)
  .option("--cursor <n>", "Row offset for pagination", "0")
  .option("-v, --verbose", "Show extra columns")
  .option("--json", "Output as JSON")
  .action((opts) => {
    try {
      const sandboxes = listSandboxes({
        status: opts.status,
        provider: opts.provider,
      });

      if (opts.json) {
        const output = opts.limit || opts.cursor !== "0"
          ? pageItems(sandboxes, { limit: opts.limit, cursor: opts.cursor })
          : sandboxes;
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      if (sandboxes.length === 0) {
        console.log(chalk.dim("No sandboxes found."));
        return;
      }

      const page = pageItems(sandboxes, { limit: opts.limit, cursor: opts.cursor });
      if (opts.verbose) {
        printTable(
          ["ID", "NAME", "PROVIDER", "STATUS", "PROVIDER ID", "IMAGE", "TIMEOUT", "CREATED"],
          page.items.map((s) => [
            s.id,
            truncateText(s.name || "—", 32),
            s.provider,
            statusColor(s.status),
            truncateText(s.provider_sandbox_id || "—", 24),
            truncateText(s.image || "default", 48),
            `${s.timeout}s`,
            new Date(s.created_at).toLocaleString(),
          ])
        );
      } else {
        printTable(
          ["ID", "NAME", "PROVIDER", "STATUS", "IMAGE", "CREATED"],
          page.items.map((s) => [
            shortId(s.id),
            truncateText(s.name || "—", 24),
            s.provider,
            statusColor(s.status),
            truncateText(s.image || "default", 32),
            new Date(s.created_at).toLocaleDateString(),
          ])
        );
      }
      printPageHint(page, "use sandboxes show <id> or --verbose for details");
    } catch (err) {
      handleError(err);
    }
  });

// ── show ─────────────────────────────────────────────────────────────

program
  .command("show <id>")
  .description("Show sandbox details")
  .option("-v, --verbose", "Show env var values and full config")
  .option("--json", "Output full sandbox record as JSON")
  .action((id, opts) => {
    try {
      const sandbox = getSandbox(id);

      if (opts.json) {
        console.log(JSON.stringify(sandbox, null, 2));
        return;
      }

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
        const summary = keySummary(sandbox.env_vars);
        if (opts.verbose) {
          console.log(`  ${chalk.bold("Env Vars:")}`);
          for (const [k, v] of Object.entries(sandbox.env_vars)) {
            console.log(`    ${k}=${truncateText(v, 160)}`);
          }
        } else {
          console.log(`  ${chalk.bold("Env Vars:")}          ${summary.keys.join(", ")} (${summary.count}; values hidden)`);
        }
      }

      if (Object.keys(sandbox.config).length > 0) {
        const summary = keySummary(sandbox.config as Record<string, unknown>);
        if (opts.verbose) {
          console.log(`  ${chalk.bold("Config:")}           ${truncateText(JSON.stringify(sandbox.config), 1000)}`);
        } else {
          console.log(`  ${chalk.bold("Config:")}           ${summary.keys.join(", ")} (${summary.count} keys)`);
        }
      }

      if (!opts.verbose) {
        console.log(chalk.dim("Hint: use --verbose for env values/full config, or --json for the complete record."));
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
    let sessionId: string | undefined;
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
      sessionId = session.id;

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

      finalizeSessionExit(session.id, execResult.exit_code);

      process.exit(execResult.exit_code);
    } catch (err) {
      if (sessionId) {
        finalizeSessionFailure(sessionId, err);
      }
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

// ── remove (alias for delete) ──────────────────────────────────────────

for (const alias of ["remove", "uninstall", "rm"]) {
  program
    .command(`${alias} <id>`)
    .description(`Delete a sandbox (alias for delete)`)
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
}

// ── logs ─────────────────────────────────────────────────────────────

program
  .command("logs <id>")
  .description("Show event logs for a sandbox")
  .option("-f, --follow", "Follow log output")
  .option("-s, --session <session_id>", "Filter by session ID")
  .option("-l, --limit <n>", `Max number of events (default ${DEFAULT_LOG_LIMIT}, max 200)`)
  .option("--cursor <n>", "Event offset for pagination", "0")
  .option("-v, --verbose", "Do not truncate event payloads")
  .option("--json", "Output events as JSON")
  .action(async (id, opts) => {
    try {
      const sandbox = getSandbox(id);
      const limit = parseLimit(opts.limit, DEFAULT_LOG_LIMIT);
      const cursor = parseNonNegativeInt(opts.cursor, 0);

      const printEvents = (events: ReturnType<typeof listEvents>) => {
        for (const event of events) {
          const time = chalk.dim(new Date(event.created_at).toLocaleTimeString());
          const type =
            event.type === "stderr"
              ? chalk.red(event.type)
              : event.type === "stdout"
                ? chalk.green(event.type)
                : chalk.blue(event.type);
          const data = opts.verbose ? (event.data || "") : truncateText(event.data || "", 240);
          console.log(`${time} ${type} ${data}`);
        }
      };

      const events = listEvents({
        sandbox_id: sandbox.id,
        session_id: opts.session,
        limit,
        offset: cursor,
      });

      if (opts.json) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }

      printEvents(events);
      if (!opts.follow) {
        const nextCursor = cursor + events.length;
        console.log(chalk.dim(`Showing ${events.length} event(s) from cursor ${cursor}.`));
        if (events.length >= Number(limit)) {
          console.log(chalk.dim(`Hint: use --cursor ${nextCursor} for more, or --verbose for untruncated payloads.`));
        } else if (!opts.verbose) {
          console.log(chalk.dim("Hint: use --verbose for untruncated payloads, or --json for complete event records."));
        }
      }

      if (opts.follow) {
        let lastCount = cursor + events.length;
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
  .option("-l, --limit <n>", `Max rows to show (default ${DEFAULT_LIST_LIMIT}, max 200)`)
  .option("--cursor <n>", "Row offset for pagination", "0")
  .option("-v, --verbose", "Show full paths")
  .option("--json", "Output file list as JSON")
  .action(async (id, path, opts) => {
    try {
      const sandbox = getSandbox(id);
      if (!sandbox.provider_sandbox_id) {
        console.error(chalk.red("Sandbox has no provider ID."));
        process.exit(1);
      }

      const p = await getProvider(sandbox.provider);
      const files = await p.listFiles(sandbox.provider_sandbox_id, path);

      if (opts.json) {
        const output = opts.limit || opts.cursor !== "0"
          ? pageItems(files, { limit: opts.limit, cursor: opts.cursor })
          : files;
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      if (files.length === 0) {
        console.log(chalk.dim("No files found."));
        return;
      }

      const page = pageItems(files, { limit: opts.limit, cursor: opts.cursor });
      printTable(
        opts.verbose ? ["NAME", "TYPE", "SIZE", "PATH"] : ["NAME", "TYPE", "SIZE"],
        page.items.map((f) => [
          f.is_dir ? chalk.blue(truncateText(f.name, 60) + "/") : truncateText(f.name, 60),
          f.is_dir ? "dir" : "file",
          f.is_dir ? chalk.dim("—") : `${f.size}`,
          ...(opts.verbose ? [truncateText(f.path, 120)] : []),
        ])
      );
      printPageHint(page, "use --verbose for full paths or --json for complete file records");
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

filesCmd
  .command("sync <id> <localDir> <remoteDir>")
  .description("Upload a local directory into a sandbox (fast archive, no git clone)")
  .option(
    "--exclude <patterns>",
    "Comma-separated exclude patterns (default: node_modules,.git,dist,…)"
  )
  .action(async (id, localDir, remoteDir, opts: { exclude?: string }) => {
    try {
      const sandbox = getSandbox(id);
      if (!sandbox.provider_sandbox_id) {
        console.error(chalk.red("Sandbox has no provider ID."));
        process.exit(1);
      }

      const p = await getProvider(sandbox.provider);
      const exclude = opts.exclude
        ? opts.exclude.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const result = await p.uploadDir(
        sandbox.provider_sandbox_id,
        localDir,
        remoteDir,
        exclude ? { exclude } : undefined
      );
      console.log(
        chalk.green(`Uploaded ${localDir} → ${remoteDir} (${result.bytes} bytes)`)
      );
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
  .requiredOption("-t, --type <type>", "Agent type: claude, takumi, codex, gemini, opencode, pi, custom")
  .requiredOption("-p, --prompt <prompt>", "Prompt for the agent")
  .option("-n, --name <name>", "Agent name")
  .option("-c, --command <cmd>", "Custom command (for 'custom' type)")
  .option(
    "--secret <mapping>",
    "Inject a vault secret as an env var: ENV_NAME=vault/key (repeatable)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[]
  )
  .action(async (id: string, opts: { type: string; prompt: string; name?: string; command?: string; secret: string[] }) => {
    try {
      const { runAgent } = await import("../lib/agent-runner.js");
      const callEnvVars = opts.secret.length
        ? await (await import("../lib/secrets.js")).resolveSecretSpecs(opts.secret)
        : undefined;
      const session = await runAgent(id, {
        agentType: opts.type as "claude" | "takumi" | "codex" | "gemini" | "opencode" | "pi" | "custom",
        prompt: opts.prompt,
        agentName: opts.name,
        command: opts.command,
        callEnvVars,
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
  .option("-l, --limit <n>", `Max events to replay (default ${DEFAULT_LOG_LIMIT}, max 200)`)
  .option("--cursor <n>", "Event offset for pagination", "0")
  .option("-v, --verbose", "Do not truncate replayed chunks")
  .action(async (id: string, opts: { session?: string; limit?: string; cursor?: string; verbose?: boolean }) => {
    try {
      const sandbox = getSandbox(id);
      const cursor = parseNonNegativeInt(opts.cursor, 0);
      const limit = parseLimit(opts.limit, DEFAULT_LOG_LIMIT);
      const events = listEvents({
        sandbox_id: sandbox.id,
        session_id: opts.session,
        limit,
        offset: cursor,
      });

      for (const event of events) {
        if (event.type === "stdout" && event.data) {
          process.stdout.write(opts.verbose ? event.data : truncateText(event.data, 1000));
        } else if (event.type === "stderr" && event.data) {
          process.stderr.write(opts.verbose ? event.data : truncateText(event.data, 1000));
        }
      }
      process.stderr.write(chalk.dim(`\nShowing ${events.length} event(s) from cursor ${cursor}. Use --cursor ${cursor + events.length} for more or --verbose for untruncated chunks.\n`));
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
  .option("-l, --limit <n>", `Max rows to show (default ${DEFAULT_LIST_LIMIT}, max 200)`)
  .option("--cursor <n>", "Row offset for pagination", "0")
  .option("-v, --verbose", "Show full descriptions")
  .option("--json", "Output as JSON")
  .action((opts) => {
    try {
      const agents = listAgents();

      if (opts.json) {
        const output = opts.limit || opts.cursor !== "0"
          ? pageItems(agents, { limit: opts.limit, cursor: opts.cursor })
          : agents;
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      if (agents.length === 0) {
        console.log(chalk.dim("No agents registered."));
        return;
      }

      const page = pageItems(agents, { limit: opts.limit, cursor: opts.cursor });
      printTable(
        ["ID", "NAME", "DESCRIPTION", "LAST SEEN"],
        page.items.map((a) => [
          shortId(a.id),
          truncateText(a.name, 32),
          opts.verbose ? (a.description || chalk.dim("—")) : truncateText(a.description || "—", 80),
          new Date(a.last_seen_at).toLocaleString(),
        ])
      );
      printPageHint(page, "use --verbose for full descriptions or --json for complete agent records");
    } catch (err) {
      handleError(err);
    }
  });

// ── mcp ──────────────────────────────────────────────────────────────

program
  .command("mcp")
  .description("Install MCP server for supported AI clients")
  .option("--codex", "Install for Codex")
  .option("--gemini", "Install for Gemini")
  .action((opts) => {
    try {
      const targets: string[] = [];

      if (opts.codex) targets.push("codex");
      if (opts.gemini) targets.push("gemini");
      if (targets.length === 0) targets.push("codex");

      for (const target of targets) {
        switch (target) {
          case "codex": {
            console.log(chalk.yellow("Codex MCP installation: add the following to ~/.codex/config.toml:"));
            console.log();
            console.log(`[mcp_servers.sandboxes]`);
            console.log(`command = "bunx"`);
            console.log(`args = ["--bun", "--package", "@hasna/sandboxes", "sandboxes-mcp"]`);
            break;
          }
          case "gemini": {
            console.log(chalk.yellow("Gemini MCP installation: add the following to ~/.gemini/settings.json:"));
            console.log();
            console.log(JSON.stringify({
              mcpServers: {
                sandboxes: {
                  command: "bunx",
                  args: ["--bun", "--package", "@hasna/sandboxes", "sandboxes-mcp"],
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
