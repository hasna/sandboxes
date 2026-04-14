import type { SandboxProvider } from "../../providers/types.js";
import type { AgentDriver } from "./types.js";
import type { ExecResult } from "../../types/index.js";

export class TakumiDriver implements AgentDriver {
  readonly name = "takumi";
  readonly requiredEnvVars = ["ANTHROPIC_API_KEY"];

  async install(provider: SandboxProvider, providerSandboxId: string): Promise<void> {
    // Check if already installed
    const check = await provider.exec(providerSandboxId, "which takumi 2>/dev/null || echo MISSING") as ExecResult;
    if (check.stdout.trim() !== "MISSING") return;
    // Install via bun (preferred) or npm
    const bunCheck = await provider.exec(providerSandboxId, "which bun 2>/dev/null || echo MISSING") as ExecResult;
    if (bunCheck.stdout.trim() !== "MISSING") {
      await provider.exec(providerSandboxId, "bun install -g @hasnaxyz/takumi 2>&1");
    } else {
      await provider.exec(providerSandboxId, "npm install -g @hasnaxyz/takumi 2>&1 || sudo npm install -g @hasnaxyz/takumi 2>&1");
    }
  }

  async configure(provider: SandboxProvider, providerSandboxId: string, envVars: Record<string, string>): Promise<void> {
    // Skip the interactive onboarding dialogs
    const config = JSON.stringify({
      hasCompletedOnboarding: true,
      hasTrustDialogAccepted: true,
      hasAcknowledgedCostThreshold: true,
    });
    await provider.exec(providerSandboxId, `mkdir -p ~/.takumi && echo '${config}' > ~/.takumi.json`);

    // Write the npm auth token if provided so @hasnaxyz/takumi can be fetched
    const npmToken = envVars["NPM_TOKEN"] ?? envVars["NPM_AUTH_TOKEN"];
    if (npmToken) {
      await provider.exec(
        providerSandboxId,
        `echo '//registry.npmjs.org/:_authToken=${npmToken}' > ~/.npmrc`
      );
    }
  }

  buildCommand(prompt: string): string {
    return `takumi --dangerously-skip-permissions -p ${JSON.stringify(prompt)}`;
  }
}
