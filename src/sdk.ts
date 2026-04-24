import {
  createSandbox as createSandboxRecord,
  deleteSandbox as deleteSandboxRecord,
  getSandbox,
  listSandboxes,
  updateSandbox,
} from "./db/sandboxes.js";
import { createSession, getSession } from "./db/sessions.js";
import { listEvents } from "./db/events.js";
import { getProvider } from "./providers/index.js";
import type { SandboxProvider } from "./providers/types.js";
import type { ExecOptions } from "./providers/types.js";
import { getDefaultProvider, getDefaultTimeout } from "./lib/config.js";
import {
  addStreamListener,
  createStreamCollector,
  emitLifecycleEvent,
} from "./lib/stream.js";
import {
  finalizeSandboxProvisionFailure,
  finalizeSessionExit,
  finalizeSessionFailure,
} from "./lib/runtime-state.js";
import { getAgentDriver } from "./lib/agents/index.js";
import type {
  AgentType,
  CreateSandboxInput,
  ExecHandle,
  ExecResult,
  FileInfo,
  Sandbox,
  SandboxEvent,
  SandboxProviderName,
  SandboxSession,
} from "./types/index.js";
import type { StreamListener } from "./lib/stream.js";

export type ProviderFactory = (
  name: SandboxProviderName,
  apiKey?: string
) => Promise<SandboxProvider>;

export interface SandboxesSDKOptions {
  defaultProvider?: SandboxProviderName;
  providerApiKeys?: Partial<Record<SandboxProviderName, string>>;
  providerFactory?: ProviderFactory;
}

export interface ExecCommandResult {
  session: SandboxSession;
  result: ExecResult;
}

export interface RunAgentOptions {
  agentType: AgentType;
  prompt: string;
  agentName?: string;
  command?: string;
  callEnvVars?: Record<string, string>;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface WaitForSessionOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function isExecHandle(value: ExecResult | ExecHandle): value is ExecHandle {
  return typeof (value as ExecHandle).wait === "function";
}

function mergeEnv(
  sandboxEnv: Record<string, string>,
  callEnv?: Record<string, string>
): Record<string, string> | undefined {
  const merged = { ...sandboxEnv, ...callEnv };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export class SandboxesSDK {
  private readonly defaultProvider?: SandboxProviderName;
  private readonly providerApiKeys: Partial<Record<SandboxProviderName, string>>;
  private readonly providerFactory: ProviderFactory;

  constructor(options: SandboxesSDKOptions = {}) {
    this.defaultProvider = options.defaultProvider;
    this.providerApiKeys = options.providerApiKeys ?? {};
    this.providerFactory =
      options.providerFactory ??
      ((name, apiKey) => getProvider(name, apiKey));
  }

  async createSandbox(input: CreateSandboxInput = {}): Promise<Sandbox> {
    const providerName =
      input.provider ?? this.defaultProvider ?? getDefaultProvider();
    const timeout = input.timeout ?? getDefaultTimeout();
    const sandbox = createSandboxRecord({
      ...input,
      provider: providerName,
      timeout,
    });

    try {
      const provider = await this.getProvider(providerName);
      const providerSandbox = await provider.create({
        image: sandbox.image ?? undefined,
        timeout: sandbox.timeout,
        envVars: sandbox.env_vars,
        onTimeout: sandbox.on_timeout,
        autoResume: sandbox.auto_resume,
      });

      const updated = updateSandbox(sandbox.id, {
        provider_sandbox_id: providerSandbox.id,
        status: "running",
        started_at: new Date().toISOString(),
      });

      emitLifecycleEvent(updated.id, "sandbox created");
      return updated;
    } catch (error) {
      finalizeSandboxProvisionFailure(sandbox.id, error);
      throw error;
    }
  }

  getSandbox(id: string): Sandbox {
    return getSandbox(id);
  }

  listSandboxes(filters?: Parameters<typeof listSandboxes>[0]): Sandbox[] {
    return listSandboxes(filters);
  }

  async stopSandbox(id: string): Promise<Sandbox> {
    const sandbox = getSandbox(id);
    if (sandbox.provider_sandbox_id) {
      const provider = await this.getProvider(sandbox.provider);
      await provider.stop(sandbox.provider_sandbox_id);
    }
    const updated = updateSandbox(sandbox.id, { status: "stopped" });
    emitLifecycleEvent(updated.id, "sandbox stopped");
    return updated;
  }

  async deleteSandbox(id: string): Promise<void> {
    const sandbox = getSandbox(id);
    if (sandbox.provider_sandbox_id) {
      const provider = await this.getProvider(sandbox.provider);
      await provider.delete(sandbox.provider_sandbox_id);
    }
    emitLifecycleEvent(sandbox.id, "sandbox deleted");
    deleteSandboxRecord(sandbox.id);
  }

  async execCommand(
    sandboxId: string,
    command: string,
    opts: ExecOptions = {}
  ): Promise<ExecCommandResult> {
    const sandbox = this.requireProviderSandbox(sandboxId);
    const provider = await this.getProvider(sandbox.provider);
    const session = createSession({
      sandbox_id: sandbox.id,
      command,
    });
    const collector = createStreamCollector(sandbox.id, session.id);

    try {
      const resultOrHandle = await provider.exec(
        sandbox.provider_sandbox_id,
        command,
        {
          ...opts,
          env: mergeEnv(sandbox.env_vars, opts.env),
          onStdout: (data) => {
            collector.onStdout(data);
            opts.onStdout?.(data);
          },
          onStderr: (data) => {
            collector.onStderr(data);
            opts.onStderr?.(data);
          },
        }
      );
      const result = isExecHandle(resultOrHandle)
        ? await resultOrHandle.wait()
        : resultOrHandle;
      finalizeSessionExit(session.id, result.exit_code);

      return {
        session: getSession(session.id),
        result,
      };
    } catch (error) {
      finalizeSessionFailure(session.id, error);
      throw error;
    }
  }

  async readFile(
    sandboxId: string,
    path: string,
    opts?: { encoding?: "utf8" | "base64" | "hex"; offset?: number; limit?: number }
  ): Promise<string> {
    const sandbox = this.requireProviderSandbox(sandboxId);
    const provider = await this.getProvider(sandbox.provider);
    return provider.readFile(sandbox.provider_sandbox_id, path, opts);
  }

  async writeFile(
    sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    const sandbox = this.requireProviderSandbox(sandboxId);
    const provider = await this.getProvider(sandbox.provider);
    await provider.writeFile(sandbox.provider_sandbox_id, path, content);
  }

  async listFiles(
    sandboxId: string,
    path: string,
    opts?: { recursive?: boolean; glob?: string }
  ): Promise<FileInfo[]> {
    const sandbox = this.requireProviderSandbox(sandboxId);
    const provider = await this.getProvider(sandbox.provider);
    return provider.listFiles(sandbox.provider_sandbox_id, path, opts);
  }

  async runAgent(
    sandboxId: string,
    opts: RunAgentOptions
  ): Promise<SandboxSession> {
    const sandbox = this.requireProviderSandbox(sandboxId);
    const provider = await this.getProvider(sandbox.provider);
    const env = mergeEnv(sandbox.env_vars, opts.callEnvVars);

    let command: string;
    const driver =
      opts.agentType !== "custom" ? getAgentDriver(opts.agentType) : undefined;

    if (opts.command) {
      command = opts.command;
    } else if (driver) {
      await driver.install(provider, sandbox.provider_sandbox_id);
      await driver.configure(
        provider,
        sandbox.provider_sandbox_id,
        env ?? {}
      );
      command = driver.buildCommand(opts.prompt);
    } else {
      command = opts.prompt;
    }

    const session = createSession({
      sandbox_id: sandbox.id,
      agent_name: opts.agentName,
      agent_type: opts.agentType,
      command,
    });
    const collector = createStreamCollector(sandbox.id, session.id);

    emitLifecycleEvent(
      sandbox.id,
      `Agent ${opts.agentType} started: ${opts.prompt.slice(0, 100)}`
    );

    provider
      .exec(sandbox.provider_sandbox_id, command, {
        env,
        onStdout: (data) => {
          collector.onStdout(data);
          opts.onStdout?.(data);
        },
        onStderr: (data) => {
          collector.onStderr(data);
          opts.onStderr?.(data);
        },
      })
      .then(async (resultOrHandle) => {
        const result = isExecHandle(resultOrHandle)
          ? await resultOrHandle.wait()
          : resultOrHandle;
        finalizeSessionExit(session.id, result.exit_code);
        emitLifecycleEvent(
          sandbox.id,
          `Agent ${opts.agentType} finished with exit code ${result.exit_code}`
        );
      })
      .catch((error) => {
        finalizeSessionFailure(session.id, error);
        emitLifecycleEvent(
          sandbox.id,
          `Agent ${opts.agentType} failed: ${(error as Error).message}`
        );
      });

    return session;
  }

  getSession(sessionId: string): SandboxSession {
    return getSession(sessionId);
  }

  async waitForSession(
    sessionId: string,
    opts: WaitForSessionOptions = {}
  ): Promise<SandboxSession> {
    const timeoutMs = opts.timeoutMs ?? 300_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const session = getSession(sessionId);
      if (session.status !== "running") {
        return session;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Session ${sessionId} did not finish within ${timeoutMs}ms`);
  }

  listEvents(filters?: Parameters<typeof listEvents>[0]): SandboxEvent[] {
    return listEvents(filters);
  }

  onSandboxEvent(sandboxId: string, listener: StreamListener): () => void {
    return addStreamListener(sandboxId, listener);
  }

  private async getProvider(
    providerName: SandboxProviderName
  ): Promise<SandboxProvider> {
    return this.providerFactory(
      providerName,
      this.providerApiKeys[providerName]
    );
  }

  private requireProviderSandbox(sandboxId: string): Sandbox & {
    provider_sandbox_id: string;
  } {
    const sandbox = getSandbox(sandboxId);
    if (!sandbox.provider_sandbox_id) {
      throw new Error(`Sandbox ${sandbox.id} has no provider sandbox ID`);
    }
    return sandbox as Sandbox & { provider_sandbox_id: string };
  }
}

export function createSandboxesSDK(
  options?: SandboxesSDKOptions
): SandboxesSDK {
  return new SandboxesSDK(options);
}
