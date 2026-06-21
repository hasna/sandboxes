import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tarDirectory,
  buildUntarCommand,
  shellQuote,
  DEFAULT_UPLOAD_EXCLUDES,
} from "./archive.js";

let srcDir: string;
let outDir: string;

beforeEach(() => {
  srcDir = mkdtempSync(join(tmpdir(), "archive-src-"));
  outDir = mkdtempSync(join(tmpdir(), "archive-out-"));
  mkdirSync(join(srcDir, "src"), { recursive: true });
  mkdirSync(join(srcDir, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(srcDir, ".git"), { recursive: true });
  writeFileSync(join(srcDir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(srcDir, "package.json"), '{"name":"demo"}\n');
  writeFileSync(join(srcDir, "node_modules", "pkg", "dep.js"), "module.exports = 1;\n");
  writeFileSync(join(srcDir, ".git", "config"), "[core]\n");
});

afterEach(() => {
  rmSync(srcDir, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

/** Extract a tarball buffer into a directory using the system tar. */
async function extract(buf: Buffer, dest: string): Promise<void> {
  const proc = Bun.spawn(["tar", "-xzf", "-", "-C", dest], {
    stdin: buf,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(await new Response(proc.stderr).text());
}

describe("tarDirectory", () => {
  it("archives directory contents and round-trips through extraction", async () => {
    const buf = await tarDirectory(srcDir);
    expect(buf.length).toBeGreaterThan(0);
    await extract(buf, outDir);

    expect(existsSync(join(outDir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(outDir, "package.json"))).toBe(true);
    expect(readFileSync(join(outDir, "src", "index.ts"), "utf8")).toBe(
      "export const x = 1;\n"
    );
  });

  it("excludes default heavy directories (node_modules, .git)", async () => {
    const buf = await tarDirectory(srcDir);
    await extract(buf, outDir);

    expect(existsSync(join(outDir, "node_modules"))).toBe(false);
    expect(existsSync(join(outDir, ".git"))).toBe(false);
    expect(DEFAULT_UPLOAD_EXCLUDES).toContain("node_modules");
  });

  it("honors a custom exclude list (empty includes everything)", async () => {
    const buf = await tarDirectory(srcDir, { exclude: [] });
    await extract(buf, outDir);

    expect(existsSync(join(outDir, "node_modules", "pkg", "dep.js"))).toBe(true);
    expect(existsSync(join(outDir, ".git", "config"))).toBe(true);
  });

  it("can stage the upload payload with rsync before archiving", async () => {
    const buf = await tarDirectory(srcDir, { syncStrategy: "rsync" });
    await extract(buf, outDir);

    expect(existsSync(join(outDir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(outDir, "package.json"))).toBe(true);
    expect(existsSync(join(outDir, "node_modules"))).toBe(false);
    expect(existsSync(join(outDir, ".git"))).toBe(false);
  });

  it("throws on a non-existent directory", async () => {
    await expect(tarDirectory(join(srcDir, "does-not-exist"))).rejects.toThrow(
      /not a directory/
    );
  });
});

describe("shellQuote", () => {
  it("wraps values in single quotes and escapes embedded quotes", () => {
    expect(shellQuote("/workspace")).toBe("'/workspace'");
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});

describe("buildUntarCommand", () => {
  it("builds a mkdir + extract + cleanup command with quoted paths", () => {
    expect(buildUntarCommand("/tmp/up.tar.gz", "/workspace")).toBe(
      "mkdir -p -- '/workspace' && tar -xzf '/tmp/up.tar.gz' -C '/workspace' && rm -f -- '/tmp/up.tar.gz'"
    );
  });

  it("treats leading-dash relative paths as filenames, not options", async () => {
    const archive = await tarDirectory(srcDir, { exclude: [] });
    writeFileSync(join(outDir, "-payload.tar.gz"), archive);

    const proc = Bun.spawn(
      ["sh", "-c", buildUntarCommand("-payload.tar.gz", "-dest")],
      {
        cwd: outDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode, stderr).toBe(0);
    expect(existsSync(join(outDir, "-dest", "src", "index.ts"))).toBe(true);
    expect(existsSync(join(outDir, "-payload.tar.gz"))).toBe(false);
  });
});
