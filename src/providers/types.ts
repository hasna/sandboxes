import type { ExecResult, ExecHandle, FileInfo } from "../types/index.js";

export interface CreateSandboxOpts {
  image?: string;
  timeout?: number;
  envVars?: Record<string, string>;
}

export interface ExecOptions {
  background?: boolean;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  timeout?: number;
  env?: Record<string, string>;
  cwd?: string;
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

  readFile(sandboxId: string, path: string): Promise<string>;
  writeFile(sandboxId: string, path: string, content: string): Promise<void>;
  listFiles(sandboxId: string, path: string): Promise<FileInfo[]>;

  stop(sandboxId: string): Promise<void>;
  delete(sandboxId: string): Promise<void>;
  keepAlive(sandboxId: string, durationMs?: number): Promise<void>;
}
