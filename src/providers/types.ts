import type { ExecResult, ExecHandle, FileInfo } from "../types/index.js";

export interface CreateSandboxOpts {
  image?: string;
  timeout?: number;
  envVars?: Record<string, string>;
  onTimeout?: 'pause' | 'terminate';
  autoResume?: boolean;
}

export interface ExecOptions {
  background?: boolean;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  timeout?: number;
  env?: Record<string, string>;
  cwd?: string;
  stdin?: string;    // String to pipe as stdin
  tty?: boolean;     // Allocate a TTY (best-effort)
}

export interface ProviderSandbox {
  id: string;
  status: string;
}

export interface SandboxProvider {
  readonly name: string;

  create(opts?: CreateSandboxOpts): Promise<ProviderSandbox>;

  exec(
    sandboxId: string,
    command: string,
    opts?: ExecOptions
  ): Promise<ExecResult | ExecHandle>;

  readFile(sandboxId: string, path: string, opts?: { encoding?: 'utf8' | 'base64' | 'hex'; offset?: number; limit?: number }): Promise<string>;
  writeFile(sandboxId: string, path: string, content: string): Promise<void>;
  listFiles(sandboxId: string, path: string, opts?: { recursive?: boolean; glob?: string }): Promise<FileInfo[]>;

  stop(sandboxId: string): Promise<void>;
  delete(sandboxId: string): Promise<void>;
  keepAlive(sandboxId: string, durationMs?: number): Promise<void>;

  pause(sandboxId: string): Promise<void>;
  resume(sandboxId: string): Promise<void>;

  getPublicUrl(sandboxId: string, port: number, protocol?: string): Promise<string>;
}
