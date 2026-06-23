import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "../db/database.js";
import { createSandbox, updateSandbox } from "../db/sandboxes.js";
import { listSessions } from "../db/sessions.js";
import { registerAgent } from "../db/agents.js";
import { ensureProject } from "../db/projects.js";
import type { SandboxProvider } from "../providers/types.js";
import { createRequestHandler, handleRequest } from "./serve.js";
import { getPackageVersion } from "../lib/version.js";

const TEST_TOKEN = "test-token";
const SERVE_AUTH_ENV = [
  "HASNA_SANDBOXES_SERVE_TOKEN",
  "SANDBOXES_SERVE_TOKEN",
  "HASNA_SANDBOXES_SERVE_ALLOWED_ORIGINS",
  "SANDBOXES_SERVE_ALLOWED_ORIGINS",
] as const;
const savedServeEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of SERVE_AUTH_ENV) {
    savedServeEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
  for (const key of SERVE_AUTH_ENV) {
    const value = savedServeEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedServeEnv.clear();
});

function bearerHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    ...extra,
    Authorization: `Bearer ${TEST_TOKEN}`,
  };
}

function fakeProvider(exec: SandboxProvider["exec"]): SandboxProvider {
  return { name: "e2b", exec } as unknown as SandboxProvider;
}

describe("HTTP server route logic (unit)", () => {
  it("sandbox list returns all sandboxes", () => {
    createSandbox({ provider: "e2b", name: "test1" });
    createSandbox({ provider: "e2b", name: "test2" });

    const { listSandboxes } = require("../db/sandboxes.js");
    const sandboxes = listSandboxes();
    expect(sandboxes.length).toBe(2);
  });

  it("agent registration via API", () => {
    const agent = registerAgent({ name: "brutus", description: "test agent" });
    expect(agent.name).toBe("brutus");
    expect(agent.description).toBe("test agent");
  });

  it("project registration via API", () => {
    const project = ensureProject("myproject", "/tmp/myproject");
    expect(project.name).toBe("myproject");
    expect(project.path).toBe("/tmp/myproject");
  });

  it("sandbox create and get", () => {
    const { getSandbox } = require("../db/sandboxes.js");
    const sandbox = createSandbox({ provider: "e2b", name: "test" });
    const fetched = getSandbox(sandbox.id);
    expect(fetched.name).toBe("test");
    expect(fetched.provider).toBe("e2b");
  });

  it("sandbox delete", () => {
    const { deleteSandbox, listSandboxes } = require("../db/sandboxes.js");
    const sandbox = createSandbox({ provider: "e2b" });
    expect(listSandboxes().length).toBe(1);
    deleteSandbox(sandbox.id);
    expect(listSandboxes().length).toBe(0);
  });

  it("health route reports the current package version", async () => {
    const response = await handleRequest(new Request("http://localhost/api/health"));
    const payload = await response.json() as { version: string };

    expect(response.status).toBe(200);
    expect(payload.version).toBe(getPackageVersion());
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("fails closed for protected routes when no auth token is configured", async () => {
    const response = await handleRequest(new Request("http://localhost/api/projects"));
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(503);
    expect(payload.error).toContain("auth token is not configured");
  });

  it("requires bearer auth for protected API routes", async () => {
    const handler = createRequestHandler({ token: TEST_TOKEN });

    const unauthorized = await handler(new Request("http://localhost/api/projects"));
    const authorized = await handler(new Request("http://localhost/api/projects", {
      headers: bearerHeaders(),
    }));

    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("WWW-Authenticate")).toBe('Bearer realm="sandboxes-serve"');
    expect(authorized.status).toBe(200);
  });

  it("requires bearer auth for mounted MCP routes", async () => {
    const handler = createRequestHandler({ token: TEST_TOKEN });

    const response = await handler(new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("requires bearer auth for sandbox event streams", async () => {
    const handler = createRequestHandler({ token: TEST_TOKEN });
    const sandbox = createSandbox({ provider: "e2b", name: "stream-protected" });

    const response = await handler(new Request(`http://localhost/api/sandboxes/${sandbox.id}/stream`, {
      headers: {
        Origin: "https://evil.example",
      },
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects browser preflights from untrusted origins", async () => {
    const handler = createRequestHandler({
      token: TEST_TOKEN,
      allowedOrigins: ["https://trusted.example"],
    });

    const response = await handler(new Request("http://localhost/api/sandboxes/sb/exec", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows browser preflights only for configured origins", async () => {
    const handler = createRequestHandler({
      token: TEST_TOKEN,
      allowedOrigins: ["https://trusted.example"],
    });

    const response = await handler(new Request("http://localhost/api/sandboxes/sb/exec", {
      method: "OPTIONS",
      headers: {
        Origin: "https://trusted.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://trusted.example");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("authorization, content-type");
  });

  it("project registration route preserves description", async () => {
    const handler = createRequestHandler({ token: TEST_TOKEN });
    const response = await handler(new Request("http://localhost/api/projects", {
      method: "POST",
      headers: bearerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: "described-project",
        path: "/tmp/described-project",
        description: "route-level description",
      }),
    }));
    const payload = await response.json() as { description: string };

    expect(response.status).toBe(201);
    expect(payload.description).toBe("route-level description");
  });

  it("blocks unauthenticated browser command execution before provider access", async () => {
    let execCalls = 0;
    const handler = createRequestHandler({
      token: TEST_TOKEN,
      providerResolver: async () => fakeProvider(async () => {
        execCalls += 1;
        return { exit_code: 0, stdout: "should-not-run", stderr: "" };
      }),
    });
    const sandbox = createSandbox({ provider: "e2b", name: "protected" });
    const running = updateSandbox(sandbox.id, {
      provider_sandbox_id: "provider-sandbox-id",
      status: "running",
    });

    const response = await handler(new Request(`http://localhost/api/sandboxes/${running.id}/exec`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: "id" }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(execCalls).toBe(0);
    expect(listSessions({ sandbox_id: running.id })).toHaveLength(0);
  });

  it("executes sandbox commands when bearer auth is valid", async () => {
    const execCalls: Array<{ sandboxId: string; command: string }> = [];
    const handler = createRequestHandler({
      token: TEST_TOKEN,
      providerResolver: async () => fakeProvider(async (sandboxId, command) => {
        execCalls.push({ sandboxId, command });
        return { exit_code: 0, stdout: "uid=1000", stderr: "" };
      }),
    });
    const sandbox = createSandbox({ provider: "e2b", name: "authorized" });
    const running = updateSandbox(sandbox.id, {
      provider_sandbox_id: "provider-sandbox-id",
      status: "running",
    });

    const response = await handler(new Request(`http://localhost/api/sandboxes/${running.id}/exec`, {
      method: "POST",
      headers: bearerHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ command: "id" }),
    }));
    const payload = await response.json() as { stdout: string; exit_code: number; session_id: string };

    expect(response.status).toBe(200);
    expect(payload.exit_code).toBe(0);
    expect(payload.stdout).toBe("uid=1000");
    expect(execCalls).toEqual([{ sandboxId: "provider-sandbox-id", command: "id" }]);
    expect(listSessions({ sandbox_id: running.id })[0]?.status).toBe("completed");
  });
});
