import type { SandboxProvider } from "../../providers/types.js";
import type { AgentDriver } from "./types.js";
import type { ExecResult } from "../../types/index.js";

export class CodexDriver implements AgentDriver {
  readonly name = "codex";
  readonly requiredEnvVars = ["OPENAI_API_KEY"];

  async install(provider: SandboxProvider, providerSandboxId: string): Promise<void> {
    const check = await provider.exec(providerSandboxId, "which codex 2>/dev/null || echo MISSING") as ExecResult;
    if (check.stdout.trim() !== "MISSING") return;
    await provider.exec(providerSandboxId, "npm install -g @openai/codex 2>&1 || sudo npm install -g @openai/codex 2>&1");
  }

  async configure(provider: SandboxProvider, providerSandboxId: string, _envVars: Record<string, string>): Promise<void> {
    // Pre-seed codex config for non-interactive operation
    const config = `[core]\napprovalMode = "full-auto"\nquiet = true\n`;
    await provider.exec(
      providerSandboxId,
      `mkdir -p ~/.codex && printf '${config.replace(/'/g, "'\\''")}' > ~/.codex/config.toml`
    );
  }

  buildCommand(prompt: string): string {
    return `codex --approval-mode full-auto -q ${JSON.stringify(prompt)}`;
  }
}
