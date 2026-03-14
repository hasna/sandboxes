import type { SandboxProvider } from "../../providers/types.js";
import type { AgentDriver } from "./types.js";
import type { ExecResult } from "../../types/index.js";

export class OpenCodeDriver implements AgentDriver {
  readonly name = "opencode";
  readonly requiredEnvVars = [];

  async install(provider: SandboxProvider, providerSandboxId: string): Promise<void> {
    const check = await provider.exec(providerSandboxId, "which opencode 2>/dev/null || echo MISSING") as ExecResult;
    if (check.stdout.trim() !== "MISSING") return;
    // OpenCode install via npm
    await provider.exec(providerSandboxId, "npm install -g opencode-ai 2>&1 || sudo npm install -g opencode-ai 2>&1");
  }

  async configure(_provider: SandboxProvider, _providerSandboxId: string, _envVars: Record<string, string>): Promise<void> {
    // No config pre-seeding needed for opencode
  }

  buildCommand(prompt: string): string {
    return `opencode run ${JSON.stringify(prompt)}`;
  }
}
