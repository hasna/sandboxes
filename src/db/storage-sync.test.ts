import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  SANDBOXES_STORAGE_CONFIG_ENV,
  getStorageConfig,
  getStorageConnectionString,
} from "./storage-config.js";
import {
  getStorageStatus,
  getStorageStatusWithRemoteCheck,
  hasSyncBatchErrors,
  parseStorageTables,
  STORAGE_TABLES,
} from "./storage-sync.js";

const envKeys = [
  "HASNA_SANDBOXES_DATABASE_URL",
  "SANDBOXES_DATABASE_URL",
  "HASNA_SANDBOXES_STORAGE_MODE",
  "SANDBOXES_STORAGE_MODE",
  SANDBOXES_STORAGE_CONFIG_ENV,
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("sandboxes storage sync config", () => {
  test("canonical storage database env wins over fallback env", () => {
    process.env.HASNA_SANDBOXES_DATABASE_URL = "postgres://new.example/sandboxes";
    process.env.SANDBOXES_DATABASE_URL = "postgres://fallback.example/sandboxes";

    expect(getStorageConnectionString()).toBe("postgres://new.example/sandboxes");
    expect(getStorageConfig().mode).toBe("hybrid");
  });

  test("fallback storage database env is accepted", () => {
    process.env.SANDBOXES_DATABASE_URL = "postgres://fallback.example/sandboxes";

    expect(getStorageConnectionString()).toBe("postgres://fallback.example/sandboxes");
    expect(getStorageConfig().mode).toBe("hybrid");
  });

  test("canonical storage mode wins over fallback mode", () => {
    process.env.HASNA_SANDBOXES_STORAGE_MODE = "remote";
    process.env.SANDBOXES_STORAGE_MODE = "hybrid";

    expect(getStorageConfig().mode).toBe("remote");
  });

  test("config-file-shaped postgres settings count as configured", () => {
    process.env[SANDBOXES_STORAGE_CONFIG_ENV] = JSON.stringify({
      postgres: {
        host: "db.example.com",
        username: "sandboxes",
        password_env: "SANDBOXES_DATABASE_PASSWORD",
      },
    });

    const config = getStorageConfig();
    expect(config.mode).toBe("hybrid");
    expect(getStorageStatus().configured).toBe(true);
  });

  test("remote mode without database config is not enabled", () => {
    process.env.HASNA_SANDBOXES_STORAGE_MODE = "remote";

    const status = getStorageStatus();

    expect(status.configured).toBe(false);
    expect(status.enabled).toBe(false);
    expect(status.mode).toBe("remote");
  });

  test("remote status check reports unconfigured without network access", async () => {
    process.env.HASNA_SANDBOXES_STORAGE_MODE = "remote";

    const status = await getStorageStatusWithRemoteCheck();

    expect(status.remote).toEqual({
      checked: false,
      ok: false,
      error: "Remote storage is not configured",
    });
  });

  test("sync result helpers detect partial table errors", () => {
    const result = [{ table: "projects", direction: "push" as const, rowsRead: 1, rowsWritten: 0, errors: ["conflict"] }];

    expect(hasSyncBatchErrors(result)).toBe(true);
    expect(hasSyncBatchErrors({ push: result, pull: [] })).toBe(true);
    expect(hasSyncBatchErrors([{ ...result[0]!, errors: [] }])).toBe(false);
  });

  test("resolves storage tables", () => {
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("feedback")).toEqual(["feedback"]);
    expect(() => parseStorageTables("missing")).toThrow("Unknown sandboxes sync table");
  });
});
