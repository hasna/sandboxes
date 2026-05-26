import type { SandboxProvider } from "../../providers/types.js";
import type { AgentDriver } from "./types.js";
import type { ExecResult } from "../../types/index.js";

export class ClaudeDriver implements AgentDriver {
  readonly name = "claude";
  readonly requiredEnvVars = ["ANTHROPIC_API_KEY"];

  async install(provider: SandboxProvider, providerSandboxId: string): Promise<void> {
    const check = await provider.exec(providerSandboxId, "which claude 2>/dev/null || echo MISSING") as ExecResult;
    if (check.stdout.trim() !== "MISSING") return;
    // Install via bun (preferred) or npm
    const bunCheck = await provider.exec(providerSandboxId, "which bun 2>/dev/null || echo MISSING") as ExecResult;
    if (bunCheck.stdout.trim() !== "MISSING") {
      await provider.exec(providerSandboxId, "bun install -g @anthropic-ai/claude-code 2>&1");
    } else {
      await provider.exec(providerSandboxId, "npm install -g @anthropic-ai/claude-code 2>&1 || sudo npm install -g @anthropic-ai/claude-code 2>&1");
    }
  }

  async configure(provider: SandboxProvider, providerSandboxId: string, _envVars: Record<string, string>): Promise<void> {
    // Skip the interactive onboarding/trust dialogs so claude runs headless.
    const config = JSON.stringify({
      hasCompletedOnboarding: true,
      hasTrustDialogAccepted: true,
      bypassPermissionsModeAccepted: true,
    });
    await provider.exec(providerSandboxId, `mkdir -p ~/.claude && echo '${config}' > ~/.claude.json`);
  }

  buildCommand(prompt: string): string {
    return `claude --dangerously-skip-permissions -p ${JSON.stringify(prompt)}`;
  }
}
