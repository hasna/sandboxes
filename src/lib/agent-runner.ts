import { getSandbox } from "../db/sandboxes.js";
import { createSession, endSession } from "../db/sessions.js";
import { getProvider } from "../providers/index.js";
import { createStreamCollector, emitLifecycleEvent } from "./stream.js";
import type { AgentType, SandboxSession, ExecResult } from "../types/index.js";

const AGENT_COMMANDS: Record<string, (prompt: string) => string> = {
  claude: (prompt) =>
    `claude --dangerously-skip-permissions -p ${JSON.stringify(prompt)}`,
  codex: (prompt) => `codex -q ${JSON.stringify(prompt)}`,
  gemini: (prompt) => `gemini -p ${JSON.stringify(prompt)}`,
};

export interface RunAgentOpts {
  agentType: AgentType;
  prompt: string;
  agentName?: string;
  command?: string;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export async function runAgent(
  sandboxId: string,
  opts: RunAgentOpts
): Promise<SandboxSession> {
  const sandbox = getSandbox(sandboxId);
  if (!sandbox.provider_sandbox_id) {
    throw new Error("Sandbox has no provider instance");
  }

  const cmd =
    opts.command ||
    AGENT_COMMANDS[opts.agentType]?.(opts.prompt) ||
    opts.prompt;

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

  const collector = createStreamCollector(sandbox.id, session.id);
  const provider = await getProvider(sandbox.provider);

  try {
    const result = await provider.exec(sandbox.provider_sandbox_id, cmd, {
      onStdout: (data) => {
        collector.onStdout(data);
        opts.onStdout?.(data);
      },
      onStderr: (data) => {
        collector.onStderr(data);
        opts.onStderr?.(data);
      },
      background: true,
    });

    if ("exit_code" in result) {
      const exitResult = result as ExecResult;
      const status = exitResult.exit_code === 0 ? "completed" : "failed";
      return endSession(session.id, exitResult.exit_code, status);
    }

    // Background handle — return session immediately
    return session;
  } catch (err) {
    endSession(session.id, 1, "failed");
    emitLifecycleEvent(
      sandbox.id,
      `Agent ${opts.agentType} failed: ${(err as Error).message}`
    );
    throw err;
  }
}

export async function stopAgent(sandboxId: string): Promise<void> {
  const sandbox = getSandbox(sandboxId);
  if (!sandbox.provider_sandbox_id) return;

  // Stop all running sessions by stopping the sandbox commands
  // The provider's stop will kill all running processes
  const provider = await getProvider(sandbox.provider);
  try {
    // Execute kill command to stop any running agent processes
    await provider.exec(sandbox.provider_sandbox_id, "pkill -f 'claude\\|codex\\|gemini' || true");
  } catch {
    // Best effort
  }

  emitLifecycleEvent(sandbox.id, "Agent stopped by user");
}
