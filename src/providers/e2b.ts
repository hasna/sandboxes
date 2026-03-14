import { Sandbox as E2BSandbox } from "@e2b/code-interpreter";
import { ProviderError } from "../types/index.js";
import type { ExecResult, ExecHandle, FileInfo } from "../types/index.js";
import type {
  SandboxProvider,
  ProviderSandbox,
  CreateSandboxOpts,
  ExecOptions,
} from "./types.js";

const instanceCache = new Map<string, E2BSandbox>();

export class E2BProvider implements SandboxProvider {
  readonly name = "e2b";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async create(opts?: CreateSandboxOpts): Promise<ProviderSandbox> {
    try {
      const sandbox = await E2BSandbox.create({
        apiKey: this.apiKey,
        timeoutMs: (opts?.timeout || 3600) * 1000,
        ...(opts?.onTimeout === 'pause' ? {
          lifecycle: { onTimeout: 'pause', autoResume: opts?.autoResume ?? true },
        } : {}),
      });

      instanceCache.set(sandbox.sandboxId, sandbox);

      return {
        id: sandbox.sandboxId,
        status: "running",
      };
    } catch (err) {
      throw new ProviderError(
        "e2b",
        `Failed to create sandbox: ${(err as Error).message}`
      );
    }
  }

  private async getInstance(sandboxId: string): Promise<E2BSandbox> {
    const cached = instanceCache.get(sandboxId);
    if (cached) return cached;

    try {
      const sandbox = await E2BSandbox.connect(sandboxId, {
        apiKey: this.apiKey,
      });
      instanceCache.set(sandboxId, sandbox);
      return sandbox;
    } catch (err) {
      throw new ProviderError(
        "e2b",
        `Failed to connect to sandbox ${sandboxId}: ${(err as Error).message}`
      );
    }
  }

  async exec(
    sandboxId: string,
    command: string,
    opts?: ExecOptions
  ): Promise<ExecResult | ExecHandle> {
    const sandbox = await this.getInstance(sandboxId);

    try {
      if (opts?.background) {
        const handle = await sandbox.commands.run(command, {
          background: true,
          onStdout: opts.onStdout
            ? (data: string) => opts.onStdout!(data)
            : undefined,
          onStderr: opts.onStderr
            ? (data: string) => opts.onStderr!(data)
            : undefined,
          envs: opts.env,
          cwd: opts.cwd,
          timeoutMs: opts.timeout ? opts.timeout * 1000 : undefined,
        });

        return {
          kill: async () => {
            await handle.kill();
          },
          wait: async () => {
            const result = await handle.wait();
            return {
              exit_code: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            };
          },
        } satisfies ExecHandle;
      }

      const result = await sandbox.commands.run(command, {
        onStdout: opts?.onStdout
          ? (data: string) => opts.onStdout!(data)
          : undefined,
        onStderr: opts?.onStderr
          ? (data: string) => opts.onStderr!(data)
          : undefined,
        envs: opts?.env,
        cwd: opts?.cwd,
        timeoutMs: opts?.timeout ? opts.timeout * 1000 : undefined,
      });

      return {
        exit_code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      } satisfies ExecResult;
    } catch (err) {
      throw new ProviderError(
        "e2b",
        `Failed to exec command: ${(err as Error).message}`
      );
    }
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      return await sandbox.files.read(path, { format: "text" }) as string;
    } catch (err) {
      throw new ProviderError(
        "e2b",
        `Failed to read file ${path}: ${(err as Error).message}`
      );
    }
  }

  async writeFile(
    sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      await sandbox.files.write(path, content);
    } catch (err) {
      throw new ProviderError(
        "e2b",
        `Failed to write file ${path}: ${(err as Error).message}`
      );
    }
  }

  async listFiles(sandboxId: string, path: string): Promise<FileInfo[]> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      const entries = await sandbox.files.list(path);
      return entries.map((e) => ({
        path: e.path,
        name: e.name,
        is_dir: e.type === "dir",
        size: 0,
      }));
    } catch (err) {
      throw new ProviderError(
        "e2b",
        `Failed to list files at ${path}: ${(err as Error).message}`
      );
    }
  }

  async stop(sandboxId: string): Promise<void> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      await sandbox.kill();
      instanceCache.delete(sandboxId);
    } catch (err) {
      throw new ProviderError(
        "e2b",
        `Failed to stop sandbox: ${(err as Error).message}`
      );
    }
  }

  async delete(sandboxId: string): Promise<void> {
    await this.stop(sandboxId);
  }

  async pause(sandboxId: string): Promise<void> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      await (sandbox as any).pause();
      instanceCache.delete(sandboxId);
    } catch (err) {
      throw new ProviderError('e2b', `Failed to pause sandbox: ${(err as Error).message}`);
    }
  }

  async resume(sandboxId: string): Promise<void> {
    try {
      const sandbox = await E2BSandbox.connect(sandboxId, { apiKey: this.apiKey });
      instanceCache.set(sandboxId, sandbox);
    } catch (err) {
      throw new ProviderError('e2b', `Failed to resume sandbox: ${(err as Error).message}`);
    }
  }

  async keepAlive(sandboxId: string, durationMs?: number): Promise<void> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      await (sandbox as unknown as { keepAlive(ms: number): Promise<void> }).keepAlive(durationMs || 300_000);
    } catch (err) {
      throw new ProviderError(
        "e2b",
        `Failed to keep alive: ${(err as Error).message}`
      );
    }
  }
}
