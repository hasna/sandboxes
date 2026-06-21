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
