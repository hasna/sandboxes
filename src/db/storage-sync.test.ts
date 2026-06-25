import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getStorageConfig,
  getStorageConnectionString,
} from "./storage-config.js";
import { parseStorageTables, STORAGE_TABLES } from "./storage-sync.js";

const envKeys = [
  "HASNA_SANDBOXES_DATABASE_URL",
  "SANDBOXES_DATABASE_URL",
  "HASNA_SANDBOXES_STORAGE_MODE",
  "SANDBOXES_STORAGE_MODE",
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

  test("resolves storage tables", () => {
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("feedback")).toEqual(["feedback"]);
    expect(() => parseStorageTables("missing")).toThrow("Unknown sandboxes sync table");
  });
});
