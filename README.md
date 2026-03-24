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
