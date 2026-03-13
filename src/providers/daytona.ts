import { Daytona, type Sandbox as DaytonaSandbox } from "@daytonaio/sdk";
import { ProviderError } from "../types/index.js";
import type { ExecResult, ExecHandle, FileInfo } from "../types/index.js";
import type {
  SandboxProvider,
  ProviderSandbox,
  CreateSandboxOpts,
  ExecOptions,
} from "./types.js";

const instanceCache = new Map<string, DaytonaSandbox>();

export class DaytonaProvider implements SandboxProvider {
  readonly name = "daytona";
  private client: Daytona;

  constructor(apiKey: string) {
    // Set env var so the Daytona client picks it up
    process.env.DAYTONA_API_KEY = apiKey;
    this.client = new Daytona({ apiKey });
  }

  async create(opts?: CreateSandboxOpts): Promise<ProviderSandbox> {
    try {
      const sandbox = await this.client.create(
        {
          language: "typescript",
          image: opts?.image,
          envVars: opts?.envVars,
          autoStopInterval: 0,
        },
        opts?.timeout || 60
      );

      instanceCache.set(sandbox.id, sandbox);

      return {
        id: sandbox.id,
        status: "running",
      };
    } catch (err) {
      throw new ProviderError(
        "daytona",
        `Failed to create sandbox: ${(err as Error).message}`
      );
    }
  }

  private async getInstance(sandboxId: string): Promise<DaytonaSandbox> {
    const cached = instanceCache.get(sandboxId);
    if (cached) return cached;

    try {
      const sandbox = await this.client.get(sandboxId);
      instanceCache.set(sandboxId, sandbox);
      return sandbox;
    } catch (err) {
      throw new ProviderError(
        "daytona",
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
        const sessionId = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await sandbox.process.createSession(sessionId);

        const response = await sandbox.process.executeSessionCommand(
          sessionId,
          { command, runAsync: true },
          opts.timeout
        );

        const cmdId = response.cmdId!;

        // Stream logs if callbacks are provided
        if (opts.onStdout || opts.onStderr) {
          // Use the streaming overload — Daytona sends all output via a single onLogs callback
          const logCallback = (chunk: string) => {
            if (opts.onStdout) opts.onStdout(chunk);
          };
          // Fire and forget log streaming — it resolves when the command finishes
          sandbox.process
            .getSessionCommandLogs(sessionId, cmdId, logCallback)
            .catch(() => {
              // Ignore streaming errors on cleanup
            });
        }

        return {
          kill: async () => {
            try {
              await sandbox.process.deleteSession(sessionId);
            } catch {
              // Session may already be gone
            }
          },
          wait: async () => {
            // Poll until the command has an exitCode
            let exitCode: number | undefined;
            let output = "";

            // eslint-disable-next-line no-constant-condition
            while (true) {
              const cmd = await sandbox.process.getSessionCommand(
                sessionId,
                cmdId
              );
              if (cmd.exitCode !== undefined && cmd.exitCode !== null) {
                exitCode = cmd.exitCode;
                break;
              }
              await new Promise((r) => setTimeout(r, 500));
            }

            // Retrieve final logs
            try {
              output = await sandbox.process.getSessionCommandLogs(
                sessionId,
                cmdId
              );
            } catch {
              // Logs may not be available
            }

            return {
              exit_code: exitCode!,
              stdout: output,
              stderr: "",
            };
          },
        } satisfies ExecHandle;
      }

      // Foreground execution — blocking
      const result = await sandbox.process.executeCommand(
        command,
        opts?.cwd,
        opts?.env,
        opts?.timeout
      );

      return {
        exit_code: result.exitCode,
        stdout: result.result,
        stderr: "",
      } satisfies ExecResult;
    } catch (err) {
      throw new ProviderError(
        "daytona",
        `Failed to exec command: ${(err as Error).message}`
      );
    }
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      const buffer = await sandbox.fs.downloadFile(path);
      return buffer.toString("utf-8");
    } catch (err) {
      throw new ProviderError(
        "daytona",
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
      await sandbox.fs.uploadFile(Buffer.from(content, "utf-8"), path);
    } catch (err) {
      throw new ProviderError(
        "daytona",
        `Failed to write file ${path}: ${(err as Error).message}`
      );
    }
  }

  async listFiles(sandboxId: string, path: string): Promise<FileInfo[]> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      const entries = await sandbox.fs.listFiles(path);
      return entries.map((e) => ({
        path: `${path.replace(/\/$/, "")}/${e.name}`,
        name: e.name,
        is_dir: e.isDir,
        size: e.size,
      }));
    } catch (err) {
      throw new ProviderError(
        "daytona",
        `Failed to list files at ${path}: ${(err as Error).message}`
      );
    }
  }

  async stop(sandboxId: string): Promise<void> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      await sandbox.stop();
      instanceCache.delete(sandboxId);
    } catch (err) {
      throw new ProviderError(
        "daytona",
        `Failed to stop sandbox: ${(err as Error).message}`
      );
    }
  }

  async delete(sandboxId: string): Promise<void> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      await sandbox.delete();
      instanceCache.delete(sandboxId);
    } catch (err) {
      throw new ProviderError(
        "daytona",
        `Failed to delete sandbox: ${(err as Error).message}`
      );
    }
  }

  async keepAlive(sandboxId: string, durationMs?: number): Promise<void> {
    const sandbox = await this.getInstance(sandboxId);
    try {
      // Daytona uses auto-stop intervals in minutes rather than explicit keepAlive.
      // Set the auto-stop interval to cover the requested duration, or disable it.
      const minutes = durationMs ? Math.ceil(durationMs / 60_000) : 0;
      await sandbox.setAutostopInterval(minutes);
    } catch (err) {
      throw new ProviderError(
        "daytona",
        `Failed to keep alive: ${(err as Error).message}`
      );
    }
  }
}
