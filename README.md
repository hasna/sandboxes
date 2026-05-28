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
