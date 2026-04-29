import { getSandbox } from "../db/sandboxes.js";
import { createSession } from "../db/sessions.js";
import { getProvider } from "../providers/index.js";
import { createStreamCollector, emitLifecycleEvent } from "./stream.js";
import { getAgentDriver } from "./agents/index.js";
import { finalizeSessionExit, finalizeSessionFailure } from "./runtime-state.js";
import type { AgentType, SandboxSession, ExecResult } from "../types/index.js";

export interface RunAgentOpts {
  agentType: AgentType;
  prompt: string;
  agentName?: string;
  command?: string;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  callEnvVars?: Record<string, string>;
  webhookUrl?: string;
  webhookEvents?: ('start' | 'complete' | 'error')[];
}

async function fireWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best effort — don't let webhook failure break the agent
  }
}

export async function runAgent(
  sandboxId: string,
  opts: RunAgentOpts
): Promise<SandboxSession> {
  const sandbox = getSandbox(sandboxId);
  if (!sandbox.provider_sandbox_id) {
    throw new Error("Sandbox has no provider instance");
  }

  const provider = await getProvider(sandbox.provider);
  const mergedEnv = { ...sandbox.env_vars, ...opts.callEnvVars };
  const env = Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined;

  // Resolve command via driver or custom override
  let cmd: string;
  const driver = opts.agentType !== "custom" ? getAgentDriver(opts.agentType) : undefined;

  if (opts.command) {
    // Explicit command override always wins
    cmd = opts.command;
  } else if (driver) {
    // Driver: install + configure + build command
    await driver.install(provider, sandbox.provider_sandbox_id);
    await driver.configure(provider, sandbox.provider_sandbox_id, sandbox.env_vars ?? {});
    cmd = driver.buildCommand(opts.prompt);
  } else {
    // No driver (custom or unknown) — use prompt as raw command
    cmd = opts.prompt;
  }

  const session = createSession({
    sandbox_id: sandbox.id,
    agent_name: opts.agentName,
    agent_type: opts.agentType,
    command: cmd,
  });

  emitLifecycleEvent(
    sandbox.id,
    `Agent ${opts.agentType} started: ${opts.prompt.slice(0, 100)}`
  );

  const startedAt = Date.now();
  const webhookEvents = opts.webhookEvents ?? ['start', 'complete', 'error'];

  // Fire start webhook if configured
  if (opts.webhookUrl && webhookEvents.includes('start')) {
    fireWebhook(opts.webhookUrl, {
      event: 'start',
      session_id: session.id,
      sandbox_id: sandbox.id,
      agent_type: opts.agentType,
      status: 'running',
      timestamp: new Date().toISOString(),
    });
  }

  const collector = createStreamCollector(sandbox.id, session.id);

  // Run without background:true so E2B fires callbacks, but detach so we return immediately
  provider.exec(sandbox.provider_sandbox_id, cmd, {
    onStdout: (data) => {
      collector.onStdout(data);
      opts.onStdout?.(data);
    },
    onStderr: (data) => {
      collector.onStderr(data);
      opts.onStderr?.(data);
    },
    env,
  }).then((result) => {
    const exitResult = result as ExecResult;
    const status = exitResult.exit_code === 0 ? "completed" : "failed";
    finalizeSessionExit(session.id, exitResult.exit_code ?? 0);
    emitLifecycleEvent(sandbox.id, `Agent ${opts.agentType} finished with exit code ${exitResult.exit_code}`);

    // Fire complete webhook if configured
    if (opts.webhookUrl && webhookEvents.includes('complete')) {
      fireWebhook(opts.webhookUrl, {
        event: 'complete',
        session_id: session.id,
        sandbox_id: sandbox.id,
        agent_type: opts.agentType,
        status,
        exit_code: exitResult.exit_code,
        duration_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
    }
  }).catch((err) => {
    finalizeSessionFailure(session.id, err);
    emitLifecycleEvent(sandbox.id, `Agent ${opts.agentType} failed: ${(err as Error).message}`);

    // Fire error webhook if configured
    if (opts.webhookUrl && webhookEvents.includes('error')) {
      fireWebhook(opts.webhookUrl, {
        event: 'error',
        session_id: session.id,
        sandbox_id: sandbox.id,
        agent_type: opts.agentType,
        status: 'failed',
        duration_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      });
    }
  });

  return session;
}

export async function stopAgent(sandboxId: string): Promise<void> {
  const sandbox = getSandbox(sandboxId);
  if (!sandbox.provider_sandbox_id) return;

  const provider = await getProvider(sandbox.provider);
  try {
    await provider.exec(sandbox.provider_sandbox_id, "pkill -f 'codex\\|gemini\\|opencode\\|pi\\|takumi' || true");
  } catch {
    // Best effort
  }

  emitLifecycleEvent(sandbox.id, "Agent stopped by user");
}
