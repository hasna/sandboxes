# @hasna/sandboxes

Universal cloud sandbox manager for AI coding agents.

## Commands

```bash
bun run build        # Build all entrypoints (cli, mcp, server, library)
bun test             # Run tests
bun run typecheck    # TypeScript type checking (tsc --noEmit)
bun run dev:cli      # Run CLI in dev mode
bun run dev:mcp      # Run MCP server in dev mode
bun run dev:serve    # Run HTTP server in dev mode
```

## Project Structure

```
src/
  cli/index.tsx       CLI entrypoint (Commander + Ink)
  mcp/index.ts        MCP server entrypoint (17 tools)
  server/index.ts     HTTP server entrypoint (Bun.serve on port 19430)
  server/serve.ts     HTTP route handler
  providers/
    types.ts          SandboxProvider interface
    index.ts          Provider registry / factory
    e2b.ts            e2b provider (fully implemented)
    daytona.ts        Daytona provider (stub)
    modal.ts          Modal provider (stub)
  db/
    database.ts       SQLite database init and schema
    sandboxes.ts      Sandbox CRUD
    sessions.ts       Session CRUD
    events.ts         Event logging
    agents.ts         Agent registry
    projects.ts       Project registry
    webhooks.ts       Webhook CRUD
  lib/
    config.ts         Config file management (~/.sandboxes/config.json)
    stream.ts         Real-time output streaming + lifecycle events
  types/index.ts      All TypeScript types and error classes
  index.ts            Library entrypoint (public API re-exports)
```

## Coding Conventions

- **Runtime**: Bun only. Uses `bun:sqlite` for database, `Bun.serve` for HTTP.
- **Module system**: ESM. All local imports use `.js` extensions (TypeScript convention for ESM output).
- **Build**: `bun build` with `--target bun`. External dependencies are not bundled.
- **Types**: Declarations emitted via `tsc --emitDeclarationOnly`.
- **MCP tools**: Thin stubs that call into `db/` and `providers/` layers. Each tool returns `{ content: [{ type: "text", text: JSON.stringify(data) }] }`.
- **Provider pattern**: All providers implement the `SandboxProvider` interface from `src/providers/types.ts`. Methods: `create`, `exec`, `readFile`, `writeFile`, `listFiles`, `stop`, `delete`, `keepAlive`.
- **Database rows vs domain types**: `*Row` types use raw SQLite types (strings for JSON, numbers for booleans). Domain types use parsed values. Conversion happens in the `db/` layer.
- **Error handling**: Custom error classes in `types/index.ts` (`SandboxNotFoundError`, `ProviderError`, etc.).
- **CLI**: Built with Commander for argument parsing. Uses Ink (React) for rich terminal output and chalk for colors.
- **Config**: Stored at `~/.sandboxes/config.json`. Keys: `default_provider`, `default_image`, `default_timeout`, `providers.<name>.api_key`.

## Test Pattern

Tests use Bun's built-in test runner (`bun test`). Database tests use in-memory SQLite:

```typescript
import { beforeEach, afterEach, describe, it, expect } from "bun:test";

// Reset database state between tests
beforeEach(() => { /* init fresh in-memory db */ });
afterEach(() => { /* close db */ });
```

## Key Files

- `package.json` -- Three bin entrypoints: `sandboxes`, `sandboxes-mcp`, `sandboxes-serve`
- `src/types/index.ts` -- All shared types, constants, and error classes
- `src/providers/types.ts` -- `SandboxProvider` interface that all providers implement
- `src/db/database.ts` -- Schema creation and database singleton
