import { ProviderError } from "../types/index.js";
import type { ExecResult, ExecHandle, FileInfo } from "../types/index.js";
import type {
  SandboxProvider,
  ProviderSandbox,
  CreateSandboxOpts,
  ExecOptions,
} from "./types.js";

// Cache sandbox instances by their ID
const sandboxCache = new Map<string, unknown>();

export class ModalProvider implements SandboxProvider {
  readonly name = "modal";
  private client: unknown;
  private _initialized = false;
  private _apiKey?: string;

  constructor(apiKey?: string) {
    this._apiKey = apiKey;
  }

  private async ensureClient(): Promise<unknown> {
    if (this._initialized) return this.client;
    try {
      const mod = await import("modal");
      const ModalClient = mod.ModalClient || mod.default?.ModalClient;
      if (!ModalClient) throw new Error("ModalClient not found in modal package");
      if (this._apiKey) {
        process.env["MODAL_TOKEN_SECRET"] = this._apiKey;
      }
      this.client = new ModalClient();
      this._initialized = true;
      return this.client;
    } catch (err) {
      throw new ProviderError("modal", `Modal SDK not available. Install with: bun add modal. Error: ${(err as Error).message}`);
    }
  }

  async create(opts?: CreateSandboxOpts): Promise<ProviderSandbox> {
    try {
      const client = await this.ensureClient() as Record<string, any>;
      const app = await client.apps.fromName("open-sandboxes", {
        createIfMissing: true,
      });

      const imageName = opts?.image || "ubuntu:22.04";
      const image = client.images.fromRegistry(imageName);

      const timeout = opts?.timeout || 3600;

      const createOpts: Record<string, any> = { timeout };
      if (opts?.envVars && Object.keys(opts.envVars).length > 0) {
        createOpts.envVars = opts.envVars;
      }

      const sandbox = await client.sandboxes.create(
        app,
        image,
        createOpts
      );

      const sandboxId = sandbox.id || sandbox.sandboxId || String(sandbox);
      sandboxCache.set(sandboxId, sandbox);

      return {
        id: sandboxId,
        status: "running",
      };
    } catch (err) {
      throw new ProviderError(
        "modal",
        `Failed to create sandbox: ${(err as Error).message}`
      );
    }
  }

  private getSandbox(sandboxId: string): Record<string, any> {
    const cached = sandboxCache.get(sandboxId);
    if (!cached) {
      throw new ProviderError(
        "modal",
        `Sandbox ${sandboxId} not found in cache. Modal sandboxes must be created via this provider.`
      );
    }
    return cached;
  }

  async exec(
    sandboxId: string,
    command: string,
    opts?: ExecOptions
  ): Promise<ExecResult | ExecHandle> {
    const sandbox = this.getSandbox(sandboxId);

    try {
      // Split command into program + args for Modal's exec API
      const parts = this.parseCommand(command);
      const program = parts[0];
      const args = parts.slice(1);

      if (opts?.background) {
        const proc = await sandbox.exec(program, ...args);

        return {
          kill: async () => {
            try {
              if (proc.kill) await proc.kill();
              else if (proc.terminate) await proc.terminate();
            } catch {
              // Best-effort kill
            }
          },
          wait: async () => {
            let stdout = "";
            let stderr = "";

            try {
              if (proc.stdout && proc.stdout.read) {
                stdout = await proc.stdout.read();
              }
              if (proc.stderr && proc.stderr.read) {
                stderr = await proc.stderr.read();
              }
            } catch {
              // Stream may already be consumed
            }

            const exitCode =
              proc.exitCode ?? proc.exit_code ?? proc.returncode ?? 0;

            if (opts?.onStdout && stdout) opts.onStdout(stdout);
            if (opts?.onStderr && stderr) opts.onStderr(stderr);

            return {
              exit_code: exitCode,
              stdout,
              stderr,
            };
          },
        } satisfies ExecHandle;
      }

      // Foreground execution — wait for completion
      const proc = await sandbox.exec(program, ...args);

      let stdout = "";
      let stderr = "";

      if (proc.stdout && proc.stdout.read) {
        stdout = await proc.stdout.read();
      }
      if (proc.stderr && proc.stderr.read) {
        stderr = await proc.stderr.read();
      }

      const exitCode =
        proc.exitCode ?? proc.exit_code ?? proc.returncode ?? 0;

      if (opts?.onStdout && stdout) opts.onStdout(stdout);
      if (opts?.onStderr && stderr) opts.onStderr(stderr);

      return {
        exit_code: exitCode,
        stdout,
        stderr,
      } satisfies ExecResult;
    } catch (err) {
      throw new ProviderError(
        "modal",
        `Failed to exec command: ${(err as Error).message}`
      );
    }
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    try {
      const result = await this.exec(sandboxId, `cat ${this.shellEscape(path)}`);
      const execResult = result as ExecResult;
      if (execResult.exit_code !== 0) {
        throw new Error(execResult.stderr || `cat exited with code ${execResult.exit_code}`);
      }
      return execResult.stdout;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        "modal",
        `Failed to read file ${path}: ${(err as Error).message}`
      );
    }
  }

  async writeFile(
    sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    try {
      // Ensure parent directory exists, then write content via base64 to avoid shell escaping issues
      const encoded = Buffer.from(content).toString("base64");
      const dirPath = path.substring(0, path.lastIndexOf("/")) || "/";
      const cmd = `mkdir -p ${this.shellEscape(dirPath)} && echo ${encoded} | base64 -d > ${this.shellEscape(path)}`;
      const result = await this.exec(sandboxId, `sh -c ${this.shellEscape(cmd)}`);
      const execResult = result as ExecResult;
      if (execResult.exit_code !== 0) {
        throw new Error(execResult.stderr || `write exited with code ${execResult.exit_code}`);
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        "modal",
        `Failed to write file ${path}: ${(err as Error).message}`
      );
    }
  }

  async listFiles(sandboxId: string, path: string): Promise<FileInfo[]> {
    try {
      // Use ls -la to get detailed file listing, skip the "total" header line
      const result = await this.exec(
        sandboxId,
        `ls -la ${this.shellEscape(path)}`
      );
      const execResult = result as ExecResult;
      if (execResult.exit_code !== 0) {
        throw new Error(execResult.stderr || `ls exited with code ${execResult.exit_code}`);
      }

      const lines = execResult.stdout.split("\n").filter((l) => l.trim());
      const files: FileInfo[] = [];

      for (const line of lines) {
        // Skip the "total" header line
        if (line.startsWith("total ")) continue;

        // Parse ls -la output: permissions links owner group size month day time name
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;

        const permissions = parts[0] || "";
        const size = parseInt(parts[4] || "0", 10) || 0;
        const name = parts.slice(8).join(" ");

        // Skip . and ..
        if (name === "." || name === "..") continue;

        const isDir = permissions.startsWith("d");
        const normalizedPath = path.endsWith("/") ? path : path + "/";

        files.push({
          path: normalizedPath + name,
          name,
          is_dir: isDir,
          size,
        });
      }

      return files;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        "modal",
        `Failed to list files at ${path}: ${(err as Error).message}`
      );
    }
  }

  async stop(sandboxId: string): Promise<void> {
    const sandbox = this.getSandbox(sandboxId);
    try {
      await sandbox.terminate();
      sandboxCache.delete(sandboxId);
    } catch (err) {
      throw new ProviderError(
        "modal",
        `Failed to stop sandbox: ${(err as Error).message}`
      );
    }
  }

  async delete(sandboxId: string): Promise<void> {
    await this.stop(sandboxId);
  }

  async keepAlive(_sandboxId: string, _durationMs?: number): Promise<void> {
    // Modal sandboxes have their own timeout set at creation time.
    // No explicit keep-alive mechanism needed — this is a no-op.
  }

  /**
   * Parse a command string into an array of arguments, respecting quotes.
   */
  private parseCommand(command: string): string[] {
    const args: string[] = [];
    let current = "";
    let inSingle = false;
    let inDouble = false;
    let escape = false;

    for (const char of command) {
      if (escape) {
        current += char;
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (char === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (char === " " && !inSingle && !inDouble) {
        if (current) {
          args.push(current);
          current = "";
        }
        continue;
      }
      current += char;
    }
    if (current) args.push(current);

    return args;
  }

  /**
   * Escape a string for safe use in shell commands.
   */
  private shellEscape(str: string): string {
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }
}
