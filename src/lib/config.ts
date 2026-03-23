import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SandboxesConfig, SandboxProviderName } from "../types/index.js";

const ENV_KEYS: Record<SandboxProviderName, string> = {
  e2b: "E2B_API_KEY",
  daytona: "DAYTONA_API_KEY",
  modal: "MODAL_TOKEN_ID",
};

function getConfigPath(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  const newDir = join(home, ".hasna", "sandboxes");
  const oldDir = join(home, ".sandboxes");

  // Auto-migrate from old location if new dir doesn't exist yet
  if (!existsSync(newDir) && existsSync(oldDir)) {
    try {
      mkdirSync(join(home, ".hasna"), { recursive: true });
      cpSync(oldDir, newDir, { recursive: true });
    } catch {
      // Fall through
    }
  }

  return join(newDir, "config.json");
}

export function loadConfig(): SandboxesConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};

  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as SandboxesConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: SandboxesConfig): void {
  const configPath = getConfigPath();
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function getDefaultProvider(): SandboxProviderName {
  const config = loadConfig();
  return config.default_provider || "e2b";
}

export function getDefaultTimeout(): number {
  const config = loadConfig();
  return config.default_timeout || 3600;
}

export function getDefaultImage(): string | undefined {
  const config = loadConfig();
  return config.default_image;
}

export function getProviderApiKey(provider: SandboxProviderName): string | undefined {
  const config = loadConfig();

  // 1. Check config file
  const providerConfig = config.providers?.[provider];
  if (providerConfig?.api_key) return providerConfig.api_key;

  // 2. Check environment variable
  const envKey = ENV_KEYS[provider];
  if (envKey) return process.env[envKey];

  return undefined;
}

export function setConfigValue(key: string, value: string): void {
  const config = loadConfig();

  if (key === "default_provider") {
    config.default_provider = value as SandboxProviderName;
  } else if (key === "default_image") {
    config.default_image = value;
  } else if (key === "default_timeout") {
    config.default_timeout = parseInt(value, 10);
  } else if (key.startsWith("providers.")) {
    const parts = key.split(".");
    const provider = parts[1] as SandboxProviderName;
    const field = parts[2];
    if (!config.providers) config.providers = {};
    if (!config.providers[provider]) {
      (config.providers as Record<string, Record<string, string>>)[provider] = {};
    }
    if (field) {
      (config.providers[provider] as Record<string, string>)[field] = value;
    }
  }

  saveConfig(config);
}

export function getConfigValue(key: string): string | undefined {
  const config = loadConfig();

  if (key === "default_provider") return config.default_provider;
  if (key === "default_image") return config.default_image;
  if (key === "default_timeout") return config.default_timeout?.toString();

  if (key.startsWith("providers.")) {
    const parts = key.split(".");
    const provider = parts[1] as SandboxProviderName;
    const field = parts[2];
    const providerConfig = config.providers?.[provider] as
      | Record<string, string>
      | undefined;
    if (providerConfig && field) return providerConfig[field];
  }

  return undefined;
}
