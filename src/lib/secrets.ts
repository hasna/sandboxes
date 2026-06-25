/**
 * Resolve credentials from the @hasna/secrets vault and inject them into agents
 * as per-call environment variables — never persisted to the sandbox record.
 */

export type SecretResolver = (key: string) => Promise<string>;

export interface SecretMapping {
  /** Environment variable name to expose inside the sandbox (e.g. ANTHROPIC_API_KEY). */
  env: string;
  /** Vault key to read (e.g. example/anthropic/test/api_key). */
  key: string;
}

/** Parse an `ENV_NAME=vault/key` spec into a {@link SecretMapping}. */
export function parseSecretMapping(spec: string): SecretMapping {
  const idx = spec.indexOf("=");
  if (idx <= 0) {
    throw new Error(`Invalid secret mapping "${spec}" (expected ENV_NAME=vault/key)`);
  }
  const env = spec.slice(0, idx).trim();
  const key = spec.slice(idx + 1).trim();
  if (!env || !key) {
    throw new Error(`Invalid secret mapping "${spec}" (expected ENV_NAME=vault/key)`);
  }
  return { env, key };
}

/**
 * Default resolver: read a secret value from the @hasna/secrets vault via the
 * globally-installed `secrets` CLI (`secrets get <key>`).
 */
export const cliSecretResolver: SecretResolver = async (key) => {
  const proc = Bun.spawn(["secrets", "get", key], { stdout: "pipe", stderr: "pipe" });
  const [out, errText, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`secrets get ${key} failed: ${errText.trim() || `exit ${code}`}`);
  }
  return out.replace(/\r?\n$/, "");
};

/**
 * Resolve secret mappings to an `{ ENV_NAME: value }` record using the vault.
 * The returned record is meant to be passed as per-call env vars (callEnvVars),
 * so resolved secret values are never written to the persisted sandbox record.
 */
export async function resolveSecretEnv(
  mappings: SecretMapping[],
  resolver: SecretResolver = cliSecretResolver
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const mapping of mappings) {
    env[mapping.env] = await resolver(mapping.key);
  }
  return env;
}

/** Convenience: parse `ENV=key` specs and resolve them in one step. */
export async function resolveSecretSpecs(
  specs: string[],
  resolver: SecretResolver = cliSecretResolver
): Promise<Record<string, string>> {
  return resolveSecretEnv(specs.map(parseSecretMapping), resolver);
}
