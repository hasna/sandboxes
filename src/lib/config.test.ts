import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, saveConfig, getDefaultProvider, getProviderApiKey, setConfigValue, getConfigValue } from "./config.js";

const testDir = "/tmp/test-sandboxes-config";
const testConfig = join(testDir, "config.json");

beforeEach(() => {
  // Override HOME to use test dir
  process.env["HOME"] = "/tmp/test-sandboxes-home";
  mkdirSync("/tmp/test-sandboxes-home/.hasna/sandboxes", { recursive: true });
});

afterEach(() => {
  try {
    if (existsSync("/tmp/test-sandboxes-home/.hasna/sandboxes/config.json")) {
      unlinkSync("/tmp/test-sandboxes-home/.hasna/sandboxes/config.json");
    }
  } catch { /* ignore */ }
  delete process.env["E2B_API_KEY"];
  delete process.env["DAYTONA_API_KEY"];
});

describe("config", () => {
  it("loadConfig returns empty object when no config", () => {
    const config = loadConfig();
    expect(config).toEqual({});
  });

  it("saveConfig and loadConfig roundtrip", () => {
    saveConfig({ default_provider: "daytona", default_timeout: 7200 });
    const config = loadConfig();
    expect(config.default_provider).toBe("daytona");
    expect(config.default_timeout).toBe(7200);
  });

  it("getDefaultProvider returns e2b when not set", () => {
    expect(getDefaultProvider()).toBe("e2b");
  });

  it("getDefaultProvider returns configured value", () => {
    saveConfig({ default_provider: "modal" });
    expect(getDefaultProvider()).toBe("modal");
  });

  it("getProviderApiKey from env var", () => {
    process.env["E2B_API_KEY"] = "test-key-123";
    expect(getProviderApiKey("e2b")).toBe("test-key-123");
  });

  it("getProviderApiKey from config takes priority", () => {
    process.env["E2B_API_KEY"] = "env-key";
    saveConfig({ providers: { e2b: { api_key: "config-key" } } });
    expect(getProviderApiKey("e2b")).toBe("config-key");
  });

  it("setConfigValue and getConfigValue", () => {
    setConfigValue("default_provider", "daytona");
    expect(getConfigValue("default_provider")).toBe("daytona");

    setConfigValue("default_timeout", "1800");
    expect(getConfigValue("default_timeout")).toBe("1800");
  });
});
