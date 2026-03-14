import type { SandboxProvider } from "../../providers/types.js";
import type { AgentDriver } from "./types.js";
import type { ExecResult } from "../../types/index.js";

export class GeminiDriver implements AgentDriver {
  readonly name = "gemini";
  readonly requiredEnvVars = ["GEMINI_API_KEY"];

  async install(provider: SandboxProvider, providerSandboxId: string): Promise<void> {
    const check = await provider.exec(providerSandboxId, "which gemini 2>/dev/null || echo MISSING") as ExecResult;
    if (check.stdout.trim() !== "MISSING") return;
    await provider.exec(providerSandboxId, "npm install -g @google/gemini-cli 2>&1 || sudo npm install -g @google/gemini-cli 2>&1");
  }

  async configure(provider: SandboxProvider, providerSandboxId: string, _envVars: Record<string, string>): Promise<void> {
    // Pre-seed gemini settings for non-interactive operation
    const settings = JSON.stringify({ theme: "Default", selectedAuthType: "gemini-api-key" });
    await provider.exec(
      providerSandboxId,
      `mkdir -p ~/.gemini && echo '${settings}' > ~/.gemini/settings.json`
    );
  }

  buildCommand(prompt: string): string {
    return `gemini -p ${JSON.stringify(prompt)}`;
  }
}
