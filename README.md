# @hasna/sandboxes

Universal cloud sandbox manager for AI coding agents - supports e2b, Daytona, Modal, and Kernel

[![npm](https://img.shields.io/npm/v/@hasna/sandboxes)](https://www.npmjs.com/package/@hasna/sandboxes)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/sandboxes
```

## CLI Usage

```bash
sandboxes --help
```

CLI output is compact by default for agent-friendly terminals:

- `sandboxes list`, `sandboxes agents`, `sandboxes logs`, `sandboxes files ls`, and `sandboxes agent stream` cap default rows/events and print pagination hints.
- Use `--limit <n>` and `--cursor <n>` to page through larger result sets.
- Use `--verbose` for wider human tables or untruncated text.
- Use `show <id>` for focused sandbox details.
- Use `--json` for complete machine-readable CLI output where supported. When
  combined with `--limit` or `--cursor`, JSON list commands return a paged
  object with `items`, `total`, and `next_cursor`.

## SDK One-shot Commands

Use the SDK to create a sandbox, upload a local project, run a command, and clean up:

```ts
import { createSandboxesSDK } from "@hasna/sandboxes";

const sandboxes = createSandboxesSDK();

await sandboxes.runCommandInSandbox({
  provider: "e2b",
  command: "bun test",
  upload: {
    localDir: process.cwd(),
    remoteDir: "/workspace/app",
    syncStrategy: "rsync",
  },
  cleanup: "delete",
});
```

Set `E2B_API_KEY` for E2B-backed runs. `syncStrategy: "rsync"` mirrors the local directory into a temporary staging tree with `rsync` before uploading it through the provider file APIs.

Use `provider: "kernel"` with `KERNEL_API_KEY` for Kernel browser sandboxes. Kernel runs command and file operations inside a browser session VM; container images, pause/resume, and public port forwarding are not supported by that provider.

## MCP Server

```bash
sandboxes-mcp
```

41 tools available.

MCP list/log/status tools also use compact defaults. Pass `limit`, `cursor`, and
`verbose:true` for progressive disclosure. Large text fields such as command
output, file content, logs, process commands, and network logs are truncated by
default and include `*_truncated` flags or hints when more detail is available.

## HTTP mode

```bash
sandboxes-mcp --http              # default port 8831
MCP_HTTP=1 sandboxes-mcp
```

- Health: `GET http://127.0.0.1:8831/health`
- MCP: `http://127.0.0.1:8831/mcp`
- Stdio remains default. `sandboxes-serve` also mounts `/health` and `/mcp`.

## REST API

```bash
sandboxes-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service sandboxes
cloud sync pull --service sandboxes
```

## Data Directory

Data is stored in `~/.hasna/sandboxes/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
