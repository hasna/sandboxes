import Kernel from "@onkernel/sdk";
import { randomUUID } from "node:crypto";
import { ProviderError } from "../types/index.js";
import type { ExecHandle, ExecResult, FileInfo, UploadDirOptions, UploadDirResult } from "../types/index.js";
import { buildUntarCommand, shellQuote, tarDirectory } from "../lib/archive.js";
import type {
  CreateSandboxOpts,
  ExecOptions,
  ProviderSandbox,
  SandboxProvider,
} from "./types.js";

type KernelClient = InstanceType<typeof Kernel>;

const KERNEL_MAX_TIMEOUT_SECONDS = 259_200;
const instanceCache = new Map<string, { id: string; status: string }>();

function decodeBase64(value?: string): string {
  if (!value) return "";
  return Buffer.from(value, "base64").toString("utf8");
}

function normalizeTimeoutSeconds(timeout?: number | null): number | undefined {
  if (timeout === undefined || timeout === null) return undefined;
  return Math.min(Math.max(Math.ceil(timeout), 10), KERNEL_MAX_TIMEOUT_SECONDS);
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value === "1" || value.toLowerCase() === "true";
}

function emitOutput(
  stdout: string,
  stderr: string,
  opts?: ExecOptions
): void {
  if (stdout) opts?.onStdout?.(stdout);
  if (stderr) opts?.onStderr?.(stderr);
}

export class KernelProvider implements SandboxProvider {
  readonly name = "kernel";
  private readonly client: KernelClient;

  constructor(apiKey: string) {
    this.client = new Kernel({ apiKey });
  }

  async create(opts?: CreateSandboxOpts): Promise<ProviderSandbox> {
    try {
      const browser = await this.client.browsers.create({
        headless: readBooleanEnv("KERNEL_BROWSER_HEADLESS", false),
        stealth: readBooleanEnv("KERNEL_BROWSER_STEALTH", false),
        timeout_seconds: normalizeTimeoutSeconds(opts?.timeout),
        tags: {
          provider: "hasna-sandboxes",
        },
      });

      instanceCache.set(browser.session_id, {
        id: browser.session_id,
        status: "running",
      });

      return {
        id: browser.session_id,
        status: "running",
      };
    } catch (err) {
      throw new ProviderError(
        "kernel",
        `Failed to create browser sandbox: ${(err as Error).message}`
      );
    }
  }

  async exec(
    sandboxId: string,
    command: string,
    opts?: ExecOptions
  ): Promise<ExecResult | ExecHandle> {
    if (opts?.background) {
      return this.execBackground(sandboxId, command, opts);
    }

    try {
      const prepared = await this.prepareCommand(sandboxId, command, opts);
      const result = await this.client.browsers.process.exec(sandboxId, {
        command: "bash",
        args: ["-lc", prepared.command],
        cwd: opts?.cwd ?? null,
        env: opts?.env,
        timeout_sec: normalizeTimeoutSeconds(opts?.timeout) ?? null,
      });

      const stdout = decodeBase64(result.stdout_b64);
      const stderr = decodeBase64(result.stderr_b64);
      emitOutput(stdout, stderr, opts);

      return {
        exit_code: result.exit_code ?? 0,
        stdout,
        stderr,
      } satisfies ExecResult;
    } catch (err) {
      throw new ProviderError(
        "kernel",
        `Failed to exec command: ${(err as Error).message}`
      );
    }
  }

  async readFile(
    sandboxId: string,
    path: string,
    opts?: { encoding?: "utf8" | "base64" | "hex"; offset?: number; limit?: number }
  ): Promise<string> {
    try {
      const response = await this.client.browsers.fs.readFile(sandboxId, { path });
      const bytes = Buffer.from(await response.arrayBuffer());
      const start = opts?.offset ?? 0;
      const sliced = opts?.limit === undefined
        ? bytes.subarray(start)
        : bytes.subarray(start, start + opts.limit);

      if (opts?.encoding === "base64") return sliced.toString("base64");
      if (opts?.encoding === "hex") return sliced.toString("hex");
      return sliced.toString("utf8");
    } catch (err) {
      throw new ProviderError(
        "kernel",
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
      await this.client.browsers.fs.writeFile(sandboxId, content, { path });
    } catch (err) {
      throw new ProviderError(
        "kernel",
        `Failed to write file ${path}: ${(err as Error).message}`
      );
    }
  }

  async listFiles(
    sandboxId: string,
    path: string,
    opts?: { recursive?: boolean; glob?: string }
  ): Promise<FileInfo[]> {
    try {
      if (opts?.recursive || opts?.glob) {
        return this.listFilesViaFind(sandboxId, path, opts);
      }

      const entries = await this.client.browsers.fs.listFiles(sandboxId, { path });
      return entries.map((entry) => ({
        path: entry.path,
        name: entry.name,
        is_dir: entry.is_dir,
        size: entry.size_bytes,
      }));
    } catch (err) {
      throw new ProviderError(
        "kernel",
        `Failed to list files at ${path}: ${(err as Error).message}`
      );
    }
  }

  async uploadDir(
    sandboxId: string,
    localDir: string,
    remoteDir: string,
    opts?: UploadDirOptions
  ): Promise<UploadDirResult> {
    try {
      const archive = await tarDirectory(localDir, opts);
      const remoteTar = `/tmp/sandboxes-upload-${Date.now()}.tar.gz`;
      await this.client.browsers.fs.writeFile(sandboxId, archive, { path: remoteTar });
      const result = await this.exec(sandboxId, buildUntarCommand(remoteTar, remoteDir));
      if ("wait" in result) {
        throw new Error("unexpected background upload result");
      }
      if (result.exit_code !== 0) {
        throw new Error(result.stderr || `untar exited with code ${result.exit_code}`);
      }
      return { bytes: archive.length };
    } catch (err) {
      throw new ProviderError(
        "kernel",
        `Failed to upload directory to ${remoteDir}: ${(err as Error).message}`
      );
    }
  }

  async stop(sandboxId: string): Promise<void> {
    try {
      await this.client.browsers.deleteByID(sandboxId);
      instanceCache.delete(sandboxId);
    } catch (err) {
      throw new ProviderError(
        "kernel",
        `Failed to stop browser sandbox: ${(err as Error).message}`
      );
    }
  }

  async delete(sandboxId: string): Promise<void> {
    await this.stop(sandboxId);
  }

  async keepAlive(sandboxId: string, _durationMs?: number): Promise<void> {
    try {
      await this.client.browsers.process.exec(sandboxId, { command: "true" });
    } catch (err) {
      throw new ProviderError(
        "kernel",
        `Failed to keep browser sandbox alive: ${(err as Error).message}`
      );
    }
  }

  async pause(_sandboxId: string): Promise<void> {
    throw new ProviderError("kernel", "Pause/resume is not supported by Kernel browser sandboxes");
  }

  async resume(_sandboxId: string): Promise<void> {
    throw new ProviderError("kernel", "Pause/resume is not supported by Kernel browser sandboxes");
  }

  async getPublicUrl(_sandboxId: string, port: number, _protocol?: string): Promise<string> {
    throw new ProviderError(
      "kernel",
      `Public port forwarding is not supported by the Kernel provider; use localhost:${port} from inside the browser sandbox`
    );
  }

  private async prepareCommand(
    sandboxId: string,
    command: string,
    opts?: ExecOptions
  ): Promise<{ command: string }> {
    if (opts?.stdin === undefined) return { command };

    const stdinPath = `/tmp/sandboxes-stdin-${Date.now()}-${randomUUID()}`;
    await this.client.browsers.fs.writeFile(sandboxId, opts.stdin, { path: stdinPath });
    return {
      command: `${command} < ${shellQuote(stdinPath)}; status=$?; rm -f ${shellQuote(stdinPath)}; exit "$status"`,
    };
  }

  private async execBackground(
    sandboxId: string,
    command: string,
    opts?: ExecOptions
  ): Promise<ExecHandle> {
    try {
      const prepared = await this.prepareCommand(sandboxId, command, opts);
      const spawned = await this.client.browsers.process.spawn(sandboxId, {
        command: "bash",
        args: ["-lc", prepared.command],
        allocate_tty: opts?.tty,
        cwd: opts?.cwd ?? null,
        env: opts?.env,
        timeout_sec: normalizeTimeoutSeconds(opts?.timeout) ?? null,
      });
      const processId = spawned.process_id;
      if (!processId) throw new Error("Kernel did not return a process_id");

      return {
        kill: async () => {
          await this.client.browsers.process.kill(processId, {
            id: sandboxId,
            signal: "TERM",
          });
        },
        wait: async () => this.waitForProcess(sandboxId, processId, opts),
      } satisfies ExecHandle;
    } catch (err) {
      throw new ProviderError(
        "kernel",
        `Failed to start background command: ${(err as Error).message}`
      );
    }
  }

  private async waitForProcess(
    sandboxId: string,
    processId: string,
    opts?: ExecOptions
  ): Promise<ExecResult> {
    let stdout = "";
    let stderr = "";
    let exitCode: number | undefined;

    try {
      const stream = await this.client.browsers.process.stdoutStream(processId, {
        id: sandboxId,
      });
      for await (const event of stream) {
        if (event.data_b64) {
          const data = decodeBase64(event.data_b64);
          if (event.stream === "stderr") {
            stderr += data;
            opts?.onStderr?.(data);
          } else {
            stdout += data;
            opts?.onStdout?.(data);
          }
        }
        if (event.event === "exit") {
          exitCode = event.exit_code ?? 0;
        }
      }
    } catch {
      // Fall back to status polling below if the stream is unavailable or closed early.
    }

    while (exitCode === undefined) {
      const status = await this.client.browsers.process.status(processId, {
        id: sandboxId,
      });
      if (status.state === "exited") {
        exitCode = status.exit_code ?? 0;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
      exit_code: exitCode,
      stdout,
      stderr,
    } satisfies ExecResult;
  }

  private async listFilesViaFind(
    sandboxId: string,
    path: string,
    opts: { recursive?: boolean; glob?: string }
  ): Promise<FileInfo[]> {
    const maxDepth = opts.recursive ? "" : "-maxdepth 1";
    const nameFilter = opts.glob ? `-name ${shellQuote(opts.glob)}` : "";
    const command = [
      "find",
      shellQuote(path),
      maxDepth,
      nameFilter,
      "-printf '%p\\t%f\\t%y\\t%s\\n'",
      "2>/dev/null",
      "| head -500",
    ].filter(Boolean).join(" ");
    const result = await this.exec(sandboxId, command);
    if ("wait" in result) return [];
    if (result.exit_code !== 0) return [];
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [entryPath = "", name = "", type = "f", size = "0"] = line.split("\t");
        return {
          path: entryPath,
          name,
          is_dir: type === "d",
          size: Number.parseInt(size, 10) || 0,
        };
      });
  }
}
