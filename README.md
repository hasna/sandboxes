# @hasna/sandboxes

[![npm version](https://img.shields.io/npm/v/@hasna/sandboxes.svg)](https://www.npmjs.com/package/@hasna/sandboxes)
[![license](https://img.shields.io/npm/l/@hasna/sandboxes.svg)](https://github.com/hasna/sandboxes/blob/main/LICENSE)

Universal cloud sandbox manager for AI coding agents.

## Features

- **Multi-provider** -- supports e2b, Daytona, and Modal from one interface
- **CLI** -- 15+ commands for sandbox lifecycle, file ops, config, and agent management
- **MCP server** -- 17 tools exposable to Claude Code, Codex, and Gemini
- **HTTP REST API** -- full CRUD server on port 19430 for programmatic access
- **Live streaming** -- real-time stdout/stderr capture during command execution
- **Agent-in-sandbox** -- spawn Claude, Codex, or Gemini agents inside sandboxes
- **File operations** -- read, write, and list files in remote sandboxes
- **Keep-alive** -- extend sandbox lifetimes on demand
- **Webhooks** -- register HTTP callbacks for sandbox lifecycle events
- **SQLite state tracking** -- local database for sandbox, session, agent, and project state
- **Project scoping** -- group sandboxes by project for multi-repo workflows
- **Zero config start** -- sensible defaults, configure only what you need

## Installation

```bash
# bun (recommended)
bun add -g @hasna/sandboxes

# npm
npm install -g @hasna/sandboxes
```

## Quick Start

```bash
# Create a sandbox (uses default provider)
sandboxes create --name my-dev

# List running sandboxes
sandboxes list

# Execute a command
sandboxes exec <id> ls -la /workspace

# View logs
sandboxes logs <id>

# File operations
sandboxes files ls <id> /workspace
sandboxes files read <id> /workspace/main.py
sandboxes files write <id> /workspace/main.py < main.py

# Stop and delete
sandboxes stop <id>
sandboxes delete <id>

# Configure defaults
sandboxes config set default_provider e2b
```

## Provider Setup

Each provider requires an API key. Set them via the CLI or environment variables.

### e2b

```bash
sandboxes config set providers.e2b.api_key <your-key>
# or
export E2B_API_KEY=<your-key>
```

### Daytona

```bash
sandboxes config set providers.daytona.api_key <your-key>
# or
export DAYTONA_API_KEY=<your-key>
```

### Modal

```bash
sandboxes config set providers.modal.api_key <your-key>
# or
export MODAL_API_KEY=<your-key>
```

### Default Provider

```bash
sandboxes config set default_provider e2b
sandboxes config set default_timeout 300000
sandboxes config set default_image python:3.12
```

## MCP Server

Install the MCP server so AI agents can manage sandboxes through tool calls.

### Claude Code

```bash
sandboxes mcp --claude
```

This registers the `sandboxes` MCP server via `claude mcp add`. After installation, restart Claude Code and the 17 sandbox tools will be available.

### Manual

```bash
# Run the MCP server directly over stdio
sandboxes-mcp
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `create_sandbox` | Create a new sandbox |
| `get_sandbox` | Get sandbox details by ID |
| `list_sandboxes` | List sandboxes with filters |
| `delete_sandbox` | Delete a sandbox |
| `stop_sandbox` | Stop a running sandbox |
| `keep_alive` | Extend sandbox lifetime |
| `exec_command` | Execute a command in a sandbox |
| `read_file` | Read a file from a sandbox |
| `write_file` | Write a file to a sandbox |
| `list_files` | List files in a sandbox directory |
| `get_logs` | Get sandbox/session event logs |
| `register_agent` | Register an agent |
| `list_agents` | List all registered agents |
| `register_project` | Register a project |
| `list_projects` | List all projects |
| `describe_tools` | List all available tools |
| `search_tools` | Search tools by keyword |

## CLI Reference

### Sandbox Lifecycle

```bash
sandboxes create [options]          # Create a new sandbox
  --provider <name>                 #   e2b | daytona | modal
  --name <name>                     #   Human-readable name
  --image <image>                   #   Container image
  --timeout <ms>                    #   Timeout in milliseconds
  --env <KEY=VALUE>                 #   Environment variables (repeatable)

sandboxes list [options]            # List sandboxes
  --status <status>                 #   Filter by status
  --provider <name>                 #   Filter by provider

sandboxes show <id>                 # Show sandbox details
sandboxes stop <id>                 # Stop a sandbox
sandboxes delete <id>               # Delete a sandbox
```

### Command Execution

```bash
sandboxes exec <id> <command...>    # Execute a command in a sandbox
  --background                      #   Run in background
  --timeout <ms>                    #   Command timeout
```

### Logs

```bash
sandboxes logs <id>                 # Show event logs for a sandbox
  --type <type>                     #   Filter: stdout | stderr | lifecycle | agent
  --session <session-id>            #   Filter by session
  --follow                          #   Stream logs in real time
```

### File Operations

```bash
sandboxes files ls <id> <path>      # List files in a directory
sandboxes files read <id> <path>    # Read a file
sandboxes files write <id> <path>   # Write stdin to a file
```

### Configuration

```bash
sandboxes config set <key> <value>  # Set a config value
sandboxes config get <key>          # Get a config value
```

### Agent Management

```bash
sandboxes init                      # Register an agent
sandboxes agents                    # List registered agents
```

### MCP Installation

```bash
sandboxes mcp                       # Install MCP server for AI agents
  --claude                          #   Install for Claude Code
  --codex                           #   Install for Codex
  --gemini                          #   Install for Gemini
```

## HTTP API

Start the HTTP server:

```bash
sandboxes-serve              # Default port 19430
sandboxes-serve --port 8080  # Custom port
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/sandboxes` | List sandboxes (query: `status`, `provider`) |
| `POST` | `/api/sandboxes` | Create a sandbox |
| `GET` | `/api/sandboxes/:id` | Get sandbox by ID |
| `DELETE` | `/api/sandboxes/:id` | Delete a sandbox |
| `POST` | `/api/sandboxes/:id/stop` | Stop a sandbox |
| `POST` | `/api/sandboxes/:id/exec` | Execute a command |
| `POST` | `/api/sandboxes/:id/keep-alive` | Extend lifetime |
| `GET` | `/api/sandboxes/:id/logs` | Get event logs |
| `GET` | `/api/sandboxes/:id/sessions` | List sessions |
| `GET` | `/api/sandboxes/:id/files` | List files (query: `path`) |
| `GET` | `/api/agents` | List agents |
| `POST` | `/api/agents` | Register an agent |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Register a project |
| `GET` | `/api/webhooks` | List webhooks |
| `POST` | `/api/webhooks` | Create a webhook |
| `DELETE` | `/api/webhooks/:id` | Delete a webhook |

## Architecture

```
src/
  cli/          CLI built with Commander + Ink (React for terminals)
  mcp/          MCP server using @modelcontextprotocol/sdk
  server/       HTTP REST API using Bun.serve
  providers/    Provider adapters (e2b, daytona, modal)
  db/           SQLite persistence (sandboxes, sessions, events, agents, projects, webhooks)
  lib/          Shared utilities (config, streaming)
  types/        TypeScript type definitions
```

State is stored in a local SQLite database managed by Bun's built-in `bun:sqlite`. Each sandbox tracks its provider, status, sessions, events, and associated project. The provider layer abstracts cloud-specific APIs behind a common `SandboxProvider` interface with methods for create, exec, file I/O, stop, delete, and keep-alive.

## License

Apache-2.0
