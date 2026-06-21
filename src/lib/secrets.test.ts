import { describe, expect, it } from "bun:test";
import {
  parseSecretMapping,
  resolveSecretEnv,
  resolveSecretSpecs,
  type SecretResolver,
} from "./secrets.js";

describe("parseSecretMapping", () => {
  it("parses ENV_NAME=vault/key", () => {
    expect(parseSecretMapping("ANTHROPIC_API_KEY=hasnaxyz/anthropic/live/api_key")).toEqual({
      env: "ANTHROPIC_API_KEY",
      key: "hasnaxyz/anthropic/live/api_key",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseSecretMapping("  TOKEN = a/b/c ")).toEqual({ env: "TOKEN", key: "a/b/c" });
  });

  it("rejects specs without an = or with empty sides", () => {
    expect(() => parseSecretMapping("NO_EQUALS")).toThrow(/expected ENV_NAME=vault\/key/);
    expect(() => parseSecretMapping("=onlykey")).toThrow();
    expect(() => parseSecretMapping("ONLYENV=")).toThrow();
  });

  it("rejects invalid environment variable names", () => {
    for (const spec of [
      "1TOKEN=hasnaxyz/token",
      "TOKEN-NAME=hasnaxyz/token",
      "TOKEN.NAME=hasnaxyz/token",
      "TOKEN NAME=hasnaxyz/token",
    ]) {
      expect(() => parseSecretMapping(spec)).toThrow(/valid environment variable name/);
    }
  });
});

describe("resolveSecretEnv", () => {
  it("resolves each mapping via the injected resolver, keyed by env name", async () => {
    const seen: string[] = [];
    const resolver: SecretResolver = async (key) => {
      seen.push(key);
      return `value-of-${key}`;
    };

    const env = await resolveSecretEnv(
      [
        { env: "ANTHROPIC_API_KEY", key: "hasnaxyz/anthropic/live/api_key" },
        { env: "OPENAI_API_KEY", key: "hasnaxyz/openai/live/api_key" },
      ],
      resolver
    );

    expect(env).toEqual({
      ANTHROPIC_API_KEY: "value-of-hasnaxyz/anthropic/live/api_key",
      OPENAI_API_KEY: "value-of-hasnaxyz/openai/live/api_key",
    });
    expect(seen).toEqual([
      "hasnaxyz/anthropic/live/api_key",
      "hasnaxyz/openai/live/api_key",
    ]);
  });

  it("propagates resolver errors (e.g. missing secret)", async () => {
    const resolver: SecretResolver = async () => {
      throw new Error("secrets get failed");
    };
    await expect(
      resolveSecretEnv([{ env: "X", key: "missing/key" }], resolver)
    ).rejects.toThrow(/secrets get failed/);
  });

  it("rejects invalid direct mappings before resolving secrets", async () => {
    let calls = 0;
    const resolver: SecretResolver = async () => {
      calls += 1;
      return "secret-value";
    };

    await expect(
      resolveSecretEnv([{ env: "TOKEN-NAME", key: "hasnaxyz/token" }], resolver)
    ).rejects.toThrow(/valid environment variable name/);
    expect(calls).toBe(0);
  });
});

describe("resolveSecretSpecs", () => {
  it("parses specs then resolves them", async () => {
    const resolver: SecretResolver = async (key) => `v:${key}`;
    const env = await resolveSecretSpecs(["FOO=a/b", "BAR=c/d"], resolver);
    expect(env).toEqual({ FOO: "v:a/b", BAR: "v:c/d" });
  });
});
