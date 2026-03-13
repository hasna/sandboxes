import type { SandboxProviderName } from "../types/index.js";
import { ProviderError } from "../types/index.js";
import { getProviderApiKey } from "../lib/config.js";
import type { SandboxProvider } from "./types.js";

const providerCache = new Map<string, SandboxProvider>();

export async function getProvider(
  name: SandboxProviderName,
  apiKey?: string
): Promise<SandboxProvider> {
  const key = apiKey || getProviderApiKey(name);
  const cacheKey = `${name}:${key || "default"}`;

  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  let provider: SandboxProvider;

  switch (name) {
    case "e2b": {
      if (!key) throw new ProviderError("e2b", "API key required. Set E2B_API_KEY or configure via `sandboxes config set providers.e2b.api_key <key>`");
      const { E2BProvider } = await import("./e2b.js");
      provider = new E2BProvider(key);
      break;
    }
    case "daytona": {
      if (!key) throw new ProviderError("daytona", "API key required. Set DAYTONA_API_KEY or configure via `sandboxes config set providers.daytona.api_key <key>`");
      const { DaytonaProvider } = await import("./daytona.js");
      provider = new DaytonaProvider(key);
      break;
    }
    case "modal": {
      const { ModalProvider } = await import("./modal.js");
      provider = new ModalProvider(key);
      break;
    }
    default:
      throw new ProviderError(name, `Unknown provider: ${name}`);
  }

  providerCache.set(cacheKey, provider);
  return provider;
}

export { type SandboxProvider } from "./types.js";
