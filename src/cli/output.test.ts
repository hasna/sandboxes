import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { createSandbox } from "../db/sandboxes.js";
import { addEvent } from "../db/events.js";

let tempDir: string;
let dbPath: string;
let savedDbPath: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sandboxes-cli-output-"));
  dbPath = join(tempDir, "sandboxes.db");
  savedDbPath = process.env["SANDBOXES_DB_PATH"];
  process.env["SANDBOXES_DB_PATH"] = dbPath;
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  if (savedDbPath === undefined) delete process.env["SANDBOXES_DB_PATH"];
  else process.env["SANDBOXES_DB_PATH"] = savedDbPath;
  rmSync(tempDir, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SANDBOXES_DB_PATH: dbPath,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("CLI compact output", () => {
  it("caps sandbox list output by default and hints at pagination/detail commands", async () => {
    for (let i = 0; i < 25; i++) {
      createSandbox({
        provider: "e2b",
        name: `sandbox-${i}`,
        image: `very-long-image-name-${i}-`.repeat(8),
      });
    }
    closeDatabase();

    const result = await runCli(["list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Showing 1-20 of 25.");
    expect(result.stdout).toContain("use --cursor 20 for more");
    expect(result.stdout).toContain("sandboxes show <id>");
    expect(result.stdout).toContain("sandbox-24");
    expect(result.stdout).not.toContain("sandbox-0");
  });

  it("keeps list --json machine-readable and complete by default", async () => {
    for (let i = 0; i < 25; i++) {
      createSandbox({ provider: "e2b", name: `json-sandbox-${i}` });
    }
    closeDatabase();

    const result = await runCli(["list", "--json"]);
    const payload = JSON.parse(result.stdout) as Array<{ name: string }>;

    expect(result.exitCode).toBe(0);
    expect(payload).toHaveLength(25);
    expect(payload.some((sandbox) => sandbox.name === "json-sandbox-0")).toBe(true);
  });

  it("keeps agent stream hints on stderr so stdout remains pipe-safe", async () => {
    const sandbox = createSandbox({ provider: "e2b", name: "agent-stream" });
    addEvent({ sandbox_id: sandbox.id, type: "stdout", data: "agent stdout" });
    addEvent({ sandbox_id: sandbox.id, type: "stderr", data: "agent stderr" });
    closeDatabase();

    const result = await runCli(["agent", "stream", sandbox.id, "--limit", "2"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("agent stdout");
    expect(result.stdout).not.toContain("Showing");
    expect(result.stderr).toContain("agent stderr");
    expect(result.stderr).toContain("Showing 2 event(s) from cursor 0");
  });
});
