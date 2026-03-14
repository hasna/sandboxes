import type { SandboxProvider } from "../../providers/types.js";
import type { AgentDriver } from "./types.js";
import type { ExecResult } from "../../types/index.js";

export class PiDriver implements AgentDriver {
  readonly name = "pi";
  readonly requiredEnvVars = ["PI_API_KEY"];

  async install(provider: SandboxProvider, providerSandboxId: string): Promise<void> {
    const check = await provider.exec(providerSandboxId, "which pi 2>/dev/null || echo MISSING") as ExecResult;
    if (check.stdout.trim() !== "MISSING") return;
    // Pi CLI via npm (community package)
    await provider.exec(providerSandboxId, "npm install -g @pi-ai/cli 2>&1 || sudo npm install -g @pi-ai/cli 2>&1");
  }

  async configure(_provider: SandboxProvider, _providerSandboxId: string, _envVars: Record<string, string>): Promise<void> {
    // No config pre-seeding needed
  }

  buildCommand(prompt: string): string {
    return `pi ask ${JSON.stringify(prompt)}`;
  }
}
