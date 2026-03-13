# Changelog

## [0.1.0] - 2026-03-13

### Added
- Initial release
- CLI with 15+ commands (create, list, show, exec, stop, delete, logs, files, config, agents, mcp)
- MCP server with 17 tools for AI agent integration
- HTTP REST API server on port 19430 with full CRUD endpoints
- e2b provider (fully implemented)
- Daytona provider (stub)
- Modal provider (stub)
- SQLite local state tracking for sandboxes, sessions, events, agents, projects, and webhooks
- Real-time stdout/stderr output streaming during command execution
- Agent-in-sandbox support (Claude, Codex, Gemini, custom)
- Webhook delivery system for sandbox lifecycle events
- Keep-alive mechanism to extend sandbox lifetimes
- Project scoping for multi-repo workflows
- Configuration management via `~/.sandboxes/config.json`
