import { describe, expect, it } from "bun:test";
import { ClaudeDriver } from "./claude.js";
import { getAgentDriver } from "./index.js";
import type { SandboxProvider } from "../../providers/types.js";
import type { ExecResult } from "../../types/index.js";

function fakeProvider(execImpl: (cmd: string) => ExecResult): {
  provider: SandboxProvider;
  calls: string[];
} {
  const calls: string[] = [];
  const provider = {
    name: "fake",
    async exec(_id: string, command: string) {
      calls.push(command);
      return execImpl(command);
    },
  } as unknown as SandboxProvider;
  return { provider, calls };
}

describe("ClaudeDriver", () => {
  it("has claude identity and requires ANTHROPIC_API_KEY", () => {
    const driver = new ClaudeDriver();
    expect(driver.name).toBe("claude");
    expect(driver.requiredEnvVars).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("builds a non-interactive print command with a quoted prompt", () => {
    expect(new ClaudeDriver().buildCommand("ship it")).toBe(
      'claude --dangerously-skip-permissions -p "ship it"'
    );
  });

  it("skips install when claude is already present", async () => {
    const { provider, calls } = fakeProvider((cmd) =>
      cmd.includes("which claude")
        ? { exit_code: 0, stdout: "/usr/local/bin/claude\n", stderr: "" }
        : { exit_code: 0, stdout: "", stderr: "" }
    );
    await new ClaudeDriver().install(provider, "sb");
    expect(calls).toEqual(["which claude 2>/dev/null || echo MISSING"]);
  });

  it("installs via bun when claude is missing and bun is present", async () => {
    const { provider, calls } = fakeProvider((cmd) => {
      if (cmd.includes("which claude")) return { exit_code: 0, stdout: "MISSING\n", stderr: "" };
      if (cmd.includes("which bun")) return { exit_code: 0, stdout: "/usr/local/bin/bun\n", stderr: "" };
      return { exit_code: 0, stdout: "", stderr: "" };
    });
    await new ClaudeDriver().install(provider, "sb");
    expect(calls.some((c) => c.includes("bun install -g @anthropic-ai/claude-code"))).toBe(true);
    expect(calls.some((c) => c.includes("npm install"))).toBe(false);
  });

  it("is registered in the agent driver registry", () => {
    expect(getAgentDriver("claude")?.name).toBe("claude");
  });
});
