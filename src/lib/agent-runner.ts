import { getSandbox } from "../db/sandboxes.js";
import { createSession, endSession } from "../db/sessions.js";
import { getProvider } from "../providers/index.js";
import { createStreamCollector, emitLifecycleEvent } from "./stream.js";
import type { AgentType, SandboxSession, ExecResult } from "../types/index.js";

// Onboarding config written before first claude run to prevent interactive hang.
const CLAUDE_ONBOARDING_SETUP =
  `mkdir -p ~/.claude && ` +
  `echo '{"hasCompletedOnboarding":true,"hasTrustDialogAccepted":true,"hasAcknowledgedCostThreshold":true}' > ~/.claude.json`;

const AGENT_COMMANDS: Record<string, (prompt: string) => string> = {
  claude: (prompt) =>
    `${CLAUDE_ONBOARDING_SETUP} && claude --dangerously-skip-permissions -p ${JSON.stringify(prompt)}`,
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
  const env = Object.keys(sandbox.env_vars ?? {}).length > 0 ? sandbox.env_vars : undefined;

  // Run without background:true so E2B fires onStdout/onStderr callbacks,
  // but detach the promise so runAgent returns the session immediately.
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
    endSession(session.id, exitResult.exit_code ?? 0, status);
    emitLifecycleEvent(sandbox.id, `Agent ${opts.agentType} finished with exit code ${exitResult.exit_code}`);
  }).catch((err) => {
    endSession(session.id, 1, "failed");
    emitLifecycleEvent(sandbox.id, `Agent ${opts.agentType} failed: ${(err as Error).message}`);
  });

  return session;
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
