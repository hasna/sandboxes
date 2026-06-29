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

## Automation Action Sandbox Profiles

OpenAutomations can reference sandbox requirements through `@hasna/actions`
metadata, but Sandboxes owns provider-specific execution isolation. The action
manifest should declare the minimum profile it needs instead of hardcoding a
provider token or broad machine access:

```json
{
  "schemaVersion": "1.0",
  "id": "repo.tests.run",
  "name": "Run repository tests",
  "version": "1.0.0",
  "bindings": [
    {
      "kind": "sdk",
      "package": "@hasna/sandboxes",
      "export": "createSandboxesSDK"
    }
  ],
  "sandbox": {
    "profile": "automation.command.readonly",
    "filesystem": "readonly",
    "network": "deny",
    "commands": "allowlisted",
    "allowlist": ["bun test"]
  }
}
```

Profile expectations:

- `automation.command.readonly`: read-only workspace, no network, explicit
  command allowlist
- `automation.command.workspace-write`: bounded write scopes, no ambient home
  directory writes, explicit command allowlist
- `automation.browser`: browser/Kernel-style execution with network limited to
  declared hosts
- `automation.provider`: cloud provider sandbox with explicit image, timeout,
  upload scope, cleanup behavior, and secret reference list

OpenAutomations owns queue leases, approvals, and replay. Sandboxes owns
provider selection, filesystem/network/command enforcement, cleanup, and
execution evidence. Action queues should contain the profile name and requested
policy, not raw provider credentials or unbounded shell access.

## MCP Server

```bash
sandboxes-mcp
```

47 tools available.

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

## Storage Sync

Sandboxes owns its local database and optional PostgreSQL sync path directly.
Set `HASNA_SANDBOXES_DATABASE_URL` or `SANDBOXES_DATABASE_URL`, then use:

```bash
sandboxes storage status
sandboxes storage status --check
sandboxes storage push
sandboxes storage pull
sandboxes storage sync
```

The SDK storage helpers are exported from `@hasna/sandboxes/storage`.

## Data Directory

Data is stored in `~/.hasna/sandboxes/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
