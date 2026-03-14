import type { SandboxProvider } from "../../providers/types.js";

export interface AgentDriver {
  /** Agent identifier */
  readonly name: string;

  /** Environment variable keys this agent needs (checked against sandbox env_vars) */
  readonly requiredEnvVars: string[];

  /**
   * Ensure the agent CLI is installed in the sandbox.
   * Should be idempotent — check before installing.
   */
  install(provider: SandboxProvider, providerSandboxId: string): Promise<void>;

  /**
   * Pre-seed config files / onboarding flags so the agent runs non-interactively.
   * Called after install, before buildCommand.
   */
  configure(
    provider: SandboxProvider,
    providerSandboxId: string,
    envVars: Record<string, string>
  ): Promise<void>;

  /**
   * Return the full CLI invocation string for this prompt.
   * Must be non-interactive and must not require user input.
   */
  buildCommand(prompt: string): string;
}
