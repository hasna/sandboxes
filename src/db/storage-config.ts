import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type StorageMode = "local" | "hybrid" | "remote";

export interface StorageConfig {
  mode: StorageMode;
  postgres: {
    host: string;
    port: number;
    username: string;
    password_env: string;
    ssl: boolean;
  };
}

export interface StorageEnv {
  name: string;
}

const STORAGE_CONFIG_PATH = join(homedir(), ".hasna", "sandboxes", "storage", "config.json");
export const SANDBOXES_STORAGE_ENV = "HASNA_SANDBOXES_DATABASE_URL";
export const SANDBOXES_STORAGE_FALLBACK_ENV = "SANDBOXES_DATABASE_URL";
export const SANDBOXES_STORAGE_MODE_ENV = "HASNA_SANDBOXES_STORAGE_MODE";
export const SANDBOXES_STORAGE_MODE_FALLBACK_ENV = "SANDBOXES_STORAGE_MODE";
export const SANDBOXES_STORAGE_CONFIG_ENV = "HASNA_SANDBOXES_STORAGE_CONFIG";
export const STORAGE_DATABASE_ENV = [SANDBOXES_STORAGE_ENV, SANDBOXES_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [SANDBOXES_STORAGE_MODE_ENV, SANDBOXES_STORAGE_MODE_FALLBACK_ENV] as const;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function normalizeStorageMode(value: string | undefined): StorageMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "local" || normalized === "hybrid" || normalized === "remote") return normalized;
  return undefined;
}

function readRawConfig(): Partial<StorageConfig> | null {
  const override = readEnv(SANDBOXES_STORAGE_CONFIG_ENV);
  if (override) {
    try {
      return JSON.parse(override) as Partial<StorageConfig>;
    } catch {
      return null;
    }
  }

  if (!existsSync(STORAGE_CONFIG_PATH)) return null;

  try {
    return JSON.parse(readFileSync(STORAGE_CONFIG_PATH, "utf-8")) as Partial<StorageConfig>;
  } catch {
    return null;
  }
}

export function getStorageDatabaseEnvName(): (typeof STORAGE_DATABASE_ENV)[number] | null {
  for (const name of STORAGE_DATABASE_ENV) {
    if (readEnv(name)) return name;
  }
  return null;
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  const name = getStorageDatabaseEnvName();
  return name ? { name } : null;
}

export function getStorageDatabaseUrl(): string | undefined {
  const env = getStorageDatabaseEnv();
  return env ? readEnv(env.name) : undefined;
}

export function hasStorageConfigConnection(config = getStorageConfig()): boolean {
  return Boolean(config.postgres.host && config.postgres.username);
}

export function getStorageConfig(): StorageConfig {
  const config: StorageConfig = {
    mode: "local",
    postgres: {
      host: "",
      port: 5432,
      username: "",
      password_env: "SANDBOXES_DATABASE_PASSWORD",
      ssl: true,
    },
  };

  const raw = readRawConfig();
  if (raw) {
    config.mode = normalizeStorageMode(raw.mode) ?? config.mode;
    config.postgres = {
      ...config.postgres,
      ...(raw.postgres ?? {}),
    };
  }

  const modeOverride = readEnv(SANDBOXES_STORAGE_MODE_ENV) ?? readEnv(SANDBOXES_STORAGE_MODE_FALLBACK_ENV);
  const mode = normalizeStorageMode(modeOverride);
  if (mode) {
    config.mode = mode;
  } else if ((getStorageDatabaseUrl() || hasStorageConfigConnection(config)) && config.mode === "local") {
    config.mode = "hybrid";
  }

  return config;
}

export function getStorageConnectionString(dbName = "sandboxes"): string {
  const direct = getStorageDatabaseUrl();
  if (direct) return direct;

  const config = getStorageConfig();
  const { host, port, username, password_env, ssl } = config.postgres;
  if (!host || !username) {
    throw new Error("Storage database is not configured. Set HASNA_SANDBOXES_DATABASE_URL or configure ~/.hasna/sandboxes/storage/config.json.");
  }

  const password = process.env[password_env];
  if (!password) {
    throw new Error(`Storage database password is not set. Export ${password_env}.`);
  }

  const sslParam = ssl ? "?sslmode=require" : "";
  return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}${sslParam}`;
}

export const getConnectionString = getStorageConnectionString;
