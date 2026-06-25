# @hasna/sandboxes

Universal cloud sandbox manager for AI coding agents - supports e2b, Daytona, Modal

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

Protected REST and mounted MCP routes require bearer auth. If
`HASNA_SANDBOXES_SERVE_TOKEN` is not set, `sandboxes-serve` prints a one-time
token at startup. Send API requests with `Authorization: Bearer <token>`.

Browser CORS is disabled by default. Set
`HASNA_SANDBOXES_SERVE_ALLOWED_ORIGINS` to a comma-separated list of exact
origins when a browser client must call the local server.

## Storage Sync

Remote storage sync is optional. By default sandboxes use local SQLite at `~/.hasna/sandboxes/`.

```bash
sandboxes storage status
sandboxes storage push
sandboxes storage pull
sandboxes storage sync
```

Set `HASNA_SANDBOXES_DATABASE_URL` or configure
`~/.hasna/sandboxes/storage/config.json` to run in hybrid/remote mode with
PostgreSQL.

## Data Directory

Data is stored in `~/.hasna/sandboxes/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
