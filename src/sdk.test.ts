import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDatabase, getDatabase, resetDatabase } from "./db/database.js";
import { SandboxesSDK } from "./index.js";
import type {
  ExecHandle,
  ExecResult,
  FileInfo,
  SandboxProviderName,
} from "./types/index.js";
import type {
  CreateSandboxOpts,
  ExecOptions,
  ProviderSandbox,
  SandboxProvider,
} from "./providers/types.js";

class FakeProvider implements SandboxProvider {
  readonly name = "daytona";
  readonly createCalls: CreateSandboxOpts[] = [];
  readonly files = new Map<string, string>();
  readonly deleted: string[] = [];
  readonly stopped: string[] = [];
  readonly readCalls: {
    sandboxId: string;
    path: string;
    opts?: { encoding?: "utf8" | "base64" | "hex"; offset?: number; limit?: number };
  }[] = [];
  readonly listFileCalls: {
    sandboxId: string;
    path: string;
    opts?: { recursive?: boolean; glob?: string };
  }[] = [];
  readonly execCalls: { sandboxId: string; command: string; opts?: ExecOptions }[] =
    [];

  async create(opts?: CreateSandboxOpts): Promise<ProviderSandbox> {
    this.createCalls.push(opts ?? {});
    return { id: `provider-sandbox-${this.createCalls.length}`, status: "running" };
  }

  async exec(
    sandboxId: string,
    command: string,
    opts?: ExecOptions
  ): Promise<ExecResult | ExecHandle> {
    this.execCalls.push({ sandboxId, command, opts });
    opts?.onStdout?.(`stdout:${command}`);
    opts?.onStderr?.(`stderr:${command}`);

    if (command.startsWith("which takumi")) {
      return {
        exit_code: 0,
        stdout: "/usr/local/bin/takumi\n",
        stderr: "",
      };
    }

    if (command.startsWith("which bun")) {
      return {
        exit_code: 0,
        stdout: "/usr/local/bin/bun\n",
        stderr: "",
      };
    }

    if (command === "return handle") {
      return {
        kill: async () => {},
        wait: async () => ({
          exit_code: 0,
          stdout: "handled",
          stderr: "",
        }),
      };
    }

    return {
      exit_code: command.includes("fail") ? 1 : 0,
      stdout: `stdout:${command}`,
      stderr: `stderr:${command}`,
    };
  }

  async readFile(
    sandboxId: string,
    path: string,
    opts?: { encoding?: "utf8" | "base64" | "hex"; offset?: number; limit?: number }
  ): Promise<string> {
    this.readCalls.push({ sandboxId, path, opts });
    return this.files.get(path) ?? "";
  }

  async writeFile(
    _sandboxId: string,
    path: string,
    content: string
  ): Promise<void> {
    this.files.set(path, content);
  }

  async listFiles(
    sandboxId: string,
    path: string,
    opts?: { recursive?: boolean; glob?: string }
  ): Promise<FileInfo[]> {
    this.listFileCalls.push({ sandboxId, path, opts });
    return [...this.files.keys()]
      .filter((filePath) => filePath.startsWith(path))
      .map((filePath) => ({
        path: filePath,
        name: filePath.split("/").pop() ?? filePath,
        is_dir: false,
        size: this.files.get(filePath)?.length ?? 0,
      }));
  }

  async stop(sandboxId: string): Promise<void> {
    this.stopped.push(sandboxId);
  }

  async delete(sandboxId: string): Promise<void> {
    this.deleted.push(sandboxId);
  }

  async keepAlive(_sandboxId: string, _durationMs?: number): Promise<void> {}

  async pause(_sandboxId: string): Promise<void> {}

  async resume(_sandboxId: string): Promise<void> {}

  async getPublicUrl(
    sandboxId: string,
    port: number,
    protocol = "https"
  ): Promise<string> {
    return `${protocol}://${sandboxId}.${port}.example.test`;
  }
}

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("SandboxesSDK", () => {
  it("uses default provider and provider API key options when creating sandboxes", async () => {
    const provider = new FakeProvider();
    const factoryCalls: { name: SandboxProviderName; apiKey?: string }[] = [];
    const sdk = new SandboxesSDK({
      defaultProvider: "modal",
      providerApiKeys: { modal: "modal-key" },
      providerFactory: async (name: SandboxProviderName, apiKey?: string) => {
        factoryCalls.push({ name, apiKey });
        return provider;
      },
    });

    const sandbox = await sdk.createSandbox({
      name: "takumi-workspace",
      image: "node:22",
      timeout: 123,
      env_vars: { NODE_ENV: "test" },
      on_timeout: "pause",
      auto_resume: true,
    });

    expect(sandbox.provider).toBe("modal");
    expect(sandbox.provider_sandbox_id).toBe("provider-sandbox-1");
    expect(sandbox.status).toBe("running");
    expect(factoryCalls).toEqual([{ name: "modal", apiKey: "modal-key" }]);
    expect(provider.createCalls).toEqual([
      {
        image: "node:22",
        timeout: 123,
        envVars: { NODE_ENV: "test" },
        onTimeout: "pause",
        autoResume: true,
      },
    ]);
  });

  it("creates, lists, gets, stops, and deletes provider sandboxes with events", async () => {
    const provider = new FakeProvider();
    const sdk = new SandboxesSDK({
      defaultProvider: "daytona",
      providerFactory: async () => provider,
    });

    const sandbox = await sdk.createSandbox({ name: "takumi-workspace" });
    expect(sdk.getSandbox(sandbox.id).id).toBe(sandbox.id);
    expect(sdk.listSandboxes()).toHaveLength(1);

    const events: string[] = [];
    const unsubscribe = sdk.onSandboxEvent(sandbox.id, (type, data) => {
      events.push(`${type}:${data}`);
    });

    const stopped = await sdk.stopSandbox(sandbox.id);
    expect(stopped.status).toBe("stopped");
    expect(provider.stopped).toEqual(["provider-sandbox-1"]);
    expect(events).toContain("lifecycle:sandbox stopped");
    const lifecycleEvents = sdk
      .listEvents({ sandbox_id: sandbox.id, type: "lifecycle" })
      .map((event) => event.data);
    expect(lifecycleEvents).toContain("sandbox created");
    expect(lifecycleEvents).toContain("sandbox stopped");

    unsubscribe();
    await sdk.stopSandbox(sandbox.id);
    expect(events.filter((event) => event === "lifecycle:sandbox stopped")).toHaveLength(1);

    await sdk.deleteSandbox(sandbox.id);
    expect(provider.deleted).toEqual(["provider-sandbox-1"]);
    expect(sdk.listSandboxes()).toHaveLength(0);
  });

  it("executes commands, handles exec handles, merges env, and records stream events", async () => {
    const provider = new FakeProvider();
    const sdk = new SandboxesSDK({
      defaultProvider: "daytona",
      providerFactory: async () => provider,
    });
    const sandbox = await sdk.createSandbox({
      env_vars: { BASE: "sandbox", OVERRIDE: "sandbox" },
    });

    const exec = await sdk.execCommand(sandbox.id, "echo hello", {
      env: { OVERRIDE: "call", CALL_ONLY: "call" },
    });
    expect(exec.result.exit_code).toBe(0);
    expect(exec.session.status).toBe("completed");
    expect(provider.execCalls.at(-1)?.opts?.env).toEqual({
      BASE: "sandbox",
      OVERRIDE: "call",
      CALL_ONLY: "call",
    });

    const handleExec = await sdk.execCommand(sandbox.id, "return handle");
    expect(handleExec.result.stdout).toBe("handled");
    expect(handleExec.session.status).toBe("completed");

    const streamEvents = sdk.listEvents({ sandbox_id: sandbox.id }).map((event) => `${event.type}:${event.data}`);
    expect(streamEvents).toContain("stdout:stdout:echo hello");
    expect(streamEvents).toContain("stderr:stderr:echo hello");
  });

  it("reads, writes, and lists files through the provider", async () => {
    const provider = new FakeProvider();
    const sdk = new SandboxesSDK({
      defaultProvider: "daytona",
      providerFactory: async () => provider,
    });
    const sandbox = await sdk.createSandbox();

    await sdk.writeFile(sandbox.id, "/workspace/README.md", "hello");
    expect(
      await sdk.readFile(sandbox.id, "/workspace/README.md", {
        encoding: "utf8",
        offset: 1,
        limit: 3,
      })
    ).toBe("hello");
    expect(provider.readCalls.at(-1)).toEqual({
      sandboxId: "provider-sandbox-1",
      path: "/workspace/README.md",
      opts: { encoding: "utf8", offset: 1, limit: 3 },
    });

    expect(
      await sdk.listFiles(sandbox.id, "/workspace", {
        recursive: true,
        glob: "**/*.md",
      })
    ).toEqual([
      {
        path: "/workspace/README.md",
        name: "README.md",
        is_dir: false,
        size: 5,
      },
    ]);
    expect(provider.listFileCalls.at(-1)).toEqual({
      sandboxId: "provider-sandbox-1",
      path: "/workspace",
      opts: { recursive: true, glob: "**/*.md" },
    });
  });

  it("runs custom agent commands and waits for sessions", async () => {
    const provider = new FakeProvider();
    const sdk = new SandboxesSDK({
      defaultProvider: "daytona",
      providerFactory: async () => provider,
    });
    const sandbox = await sdk.createSandbox({
      env_vars: { BASE: "sandbox" },
    });

    const agent = await sdk.runAgent(sandbox.id, {
      agentType: "custom",
      prompt: "ignored when command is set",
      command: "takumi --print task",
      callEnvVars: { CALL_ONLY: "call" },
    });
    const finished = await sdk.waitForSession(agent.id);
    expect(finished.status).toBe("completed");
    expect(provider.execCalls.at(-1)?.command).toBe("takumi --print task");
    expect(provider.execCalls.at(-1)?.opts?.env).toEqual({
      BASE: "sandbox",
      CALL_ONLY: "call",
    });
  });

  it("passes merged sandbox and call env vars to non-custom agent configuration", async () => {
    const provider = new FakeProvider();
    const npmTokenKey = "NPM" + "_TOKEN";
    const sdk = new SandboxesSDK({
      defaultProvider: "daytona",
      providerFactory: async () => provider,
    });
    const sandbox = await sdk.createSandbox({
      env_vars: { ANTHROPIC_API_KEY: "sandbox-anthropic-key" },
    });

    const agent = await sdk.runAgent(sandbox.id, {
      agentType: "takumi",
      prompt: "ship it",
      callEnvVars: {
        ANTHROPIC_API_KEY: "call-anthropic-key",
        [npmTokenKey]: "call-package-token",
      },
    });
    const finished = await sdk.waitForSession(agent.id);

    expect(finished.status).toBe("completed");
    expect(
      provider.execCalls.some((call) =>
        call.command.includes("//registry.npmjs.org/:_authToken=call-package-token")
      )
    ).toBe(true);
    expect(provider.execCalls.at(-1)?.command).toContain("takumi --dangerously-skip-permissions");
    expect(provider.execCalls.at(-1)?.opts?.env).toEqual({
      ANTHROPIC_API_KEY: "call-anthropic-key",
      [npmTokenKey]: "call-package-token",
    });
  });
});
