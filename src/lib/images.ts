/**
 * Built-in sandbox image aliases.
 * Maps a short name to the provider-specific image identifier.
 * For E2B, these are custom images or base images with setup scripts.
 */
export const BUILTIN_IMAGES: Record<string, { e2b: string; description: string; setup_script?: string }> = {
  'node20': {
    e2b: 'e2bdev/base:latest',
    description: 'Node 20 + npm + pnpm + yarn',
    setup_script: 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && npm install -g pnpm yarn',
  },
  'node20-codex': {
    e2b: 'e2bdev/base:latest',
    description: 'Node 20 + Codex CLI pre-installed',
    setup_script: 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && npm install -g @openai/codex && mkdir -p ~/.codex && echo \'[core]\napprovalMode = "full-auto"\n\' > ~/.codex/config.toml',
  },
  'python312': {
    e2b: 'e2bdev/base:latest',
    description: 'Python 3.12 + uv + pip',
    setup_script: 'apt-get update && apt-get install -y python3.12 python3-pip && pip3 install uv',
  },
  'python312-agents': {
    e2b: 'e2bdev/base:latest',
    description: 'Python 3.12 + uv + common AI libs',
    setup_script: 'apt-get update && apt-get install -y python3.12 python3-pip && pip3 install uv anthropic openai langchain',
  },
  'fullstack': {
    e2b: 'e2bdev/base:latest',
    description: 'Node 20 + Python 3.12 + git + build tools',
    setup_script: 'apt-get update && apt-get install -y git build-essential python3.12 python3-pip && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && npm install -g pnpm',
  },
};

export function resolveImage(image: string): string {
  return BUILTIN_IMAGES[image]?.e2b ?? image;
}

export function getBuiltinImageSetupScript(image: string): string | undefined {
  return BUILTIN_IMAGES[image]?.setup_script;
}
