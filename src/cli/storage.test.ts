import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

describe("sandboxes storage CLI", () => {
  test("help advertises storage sync without legacy cloud command", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("storage");
    expect(result.stdout).not.toMatch(/^\s+cloud\b/m);
  });

  test("storage status reports local mode as JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "open-sandboxes-storage-cli-"));
    try {
    const result = runCli(["storage", "status", "--check", "--json"], {
        HOME: home,
        HASNA_SANDBOXES_DB_PATH: "",
        SANDBOXES_DB_PATH: join(home, "sandboxes.db"),
        HASNA_SANDBOXES_DATABASE_URL: "",
        SANDBOXES_DATABASE_URL: "",
        HASNA_SANDBOXES_STORAGE_MODE: "local",
        SANDBOXES_STORAGE_MODE: "",
      });

      expect(result.status).toBe(0);
      const status = JSON.parse(result.stdout) as { enabled: boolean; mode: string; tables: Array<{ table: string }> };
      expect(status.enabled).toBe(false);
      expect(status.mode).toBe("local");
      expect(status.remote?.checked).toBe(false);
      expect(status.tables.map((table) => table.table)).toContain("sandboxes");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
