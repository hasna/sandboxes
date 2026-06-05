import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Directories that are almost never worth shipping into a sandbox and that
 * dominate upload size. Callers can override via `TarDirectoryOptions.exclude`.
 */
export const DEFAULT_UPLOAD_EXCLUDES = [
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "__pycache__",
];

export interface TarDirectoryOptions {
  /**
   * Path/glob patterns to exclude (matched by `tar --exclude`). A bare name
   * like `node_modules` excludes that directory and its contents at any depth
   * on both bsdtar (macOS) and GNU tar (Linux). Defaults to
   * {@link DEFAULT_UPLOAD_EXCLUDES}; pass `[]` to include everything.
   */
  exclude?: string[];
  /** Prepare a temporary upload tree with rsync before creating the archive. */
  syncStrategy?: "archive" | "rsync";
}

/** Single-quote a value for safe POSIX shell interpolation. */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * Create a gzipped tar of a local directory's contents and return it as a Buffer.
 *
 * The archive is rooted at the directory contents (members are relative, e.g.
 * `./src/index.ts`), so it extracts cleanly into any target with
 * `tar -xzf - -C <dir>`. Uses the system `tar`, which is present on macOS
 * (bsdtar) and Linux (GNU tar).
 */
export async function tarDirectory(
  localDir: string,
  opts?: TarDirectoryOptions
): Promise<Buffer> {
  if (!existsSync(localDir) || !statSync(localDir).isDirectory()) {
    throw new Error(`tarDirectory: not a directory: ${localDir}`);
  }

  if (opts?.syncStrategy === "rsync") {
    const stagingDir = mkdtempSync(join(tmpdir(), "sandboxes-rsync-"));
    try {
      await rsyncDirectory(localDir, stagingDir, opts.exclude ?? DEFAULT_UPLOAD_EXCLUDES);
      return await tarDirectory(stagingDir, { exclude: [], syncStrategy: "archive" });
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  const excludes = opts?.exclude ?? DEFAULT_UPLOAD_EXCLUDES;
  const args = ["-czf", "-"];
  for (const ex of excludes) args.push(`--exclude=${ex}`);
  args.push("-C", localDir, ".");

  const proc = Bun.spawn(["tar", ...args], { stdout: "pipe", stderr: "pipe" });
  const [buf, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`tarDirectory: tar exited ${exitCode}: ${stderr.trim()}`);
  }

  return Buffer.from(buf);
}

async function rsyncDirectory(
  localDir: string,
  stagingDir: string,
  excludes: string[],
): Promise<void> {
  const args = [
    "-a",
    "--delete",
    ...excludes.flatMap((ex) => ["--exclude", ex]),
    `${localDir.replace(/\/+$/, "")}/`,
    `${stagingDir.replace(/\/+$/, "")}/`,
  ];
  const proc = Bun.spawn(["rsync", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`rsyncDirectory: rsync exited ${exitCode}: ${stderr.trim()}`);
  }
}

/**
 * Build the shell command that unpacks an uploaded tarball into `remoteDir`
 * and removes the tarball afterward. Shared by providers that upload a single
 * archive then extract it in-sandbox.
 */
export function buildUntarCommand(remoteTarPath: string, remoteDir: string): string {
  const tar = shellQuote(remoteTarPath);
  const dir = shellQuote(remoteDir);
  return `mkdir -p ${dir} && tar -xzf ${tar} -C ${dir} && rm -f ${tar}`;
}
