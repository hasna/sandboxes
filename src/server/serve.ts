import {
  createSandbox as dbCreateSandbox,
  getSandbox,
  listSandboxes,
  updateSandbox,
  deleteSandbox as dbDeleteSandbox,
} from "../db/sandboxes.js";
import { createSession, listSessions, endSession } from "../db/sessions.js";
import { listEvents } from "../db/events.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { listProjects, ensureProject } from "../db/projects.js";
import { listWebhooks, createWebhook, deleteWebhook } from "../db/webhooks.js";
import { getProvider } from "../providers/index.js";
import { getDefaultProvider, getDefaultTimeout } from "../lib/config.js";
import { createStreamCollector, emitLifecycleEvent } from "../lib/stream.js";
import { addStreamListener } from "../lib/stream.js";
import type { SandboxProviderName, CreateSandboxInput } from "../types/index.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

function matchRoute(
  pathname: string,
  method: string,
  pattern: string,
  expectedMethod: string
): Record<string, string> | null {
  if (method !== expectedMethod) return null;

  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    const pathPart = pathParts[i]!;
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = pathPart;
    } else if (pp !== pathPart) {
      return null;
    }
  }
  return params;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  if (method === "OPTIONS") {
    return json({ ok: true });
  }

  // Health check
  if (pathname === "/api/health" && method === "GET") {
    return json({ status: "ok", version: "0.1.0" });
  }

  // ── Sandboxes ──────────────────────────────────────────────────────

  if (pathname === "/api/sandboxes" && method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    const provider = url.searchParams.get("provider") || undefined;
    const result = listSandboxes({
      status: status as "creating" | "running" | "paused" | "stopped" | "deleted" | "error" | undefined,
      provider: provider as SandboxProviderName,
    });
    return json(result);
  }

  if (pathname === "/api/sandboxes" && method === "POST") {
    try {
      const input = await body<CreateSandboxInput>(req);
      const providerName = input.provider || getDefaultProvider();
      const timeout = input.timeout || getDefaultTimeout();

      const sandbox = dbCreateSandbox({ ...input, provider: providerName, timeout });

      const provider = await getProvider(providerName);
      const providerSandbox = await provider.create({
        image: input.image,
        timeout,
        envVars: input.env_vars,
      });

      const updated = updateSandbox(sandbox.id, {
        provider_sandbox_id: providerSandbox.id,
        status: "running",
      });

      emitLifecycleEvent(sandbox.id, `Sandbox created with provider ${providerName}`);
      return json(updated, 201);
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  let params = matchRoute(pathname, method, "/api/sandboxes/:id", "GET");
  if (params) {
    try {
      return json(getSandbox(params["id"]!));
    } catch (err) {
      return error((err as Error).message, 404);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id", "DELETE");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (sandbox.provider_sandbox_id) {
        const provider = await getProvider(sandbox.provider);
        await provider.delete(sandbox.provider_sandbox_id);
      }
      dbDeleteSandbox(sandbox.id);
      emitLifecycleEvent(sandbox.id, "Sandbox deleted");
      return json({ ok: true });
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/stop", "POST");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (sandbox.provider_sandbox_id) {
        const provider = await getProvider(sandbox.provider);
        await provider.stop(sandbox.provider_sandbox_id);
      }
      const updated = updateSandbox(sandbox.id, { status: "stopped" });
      emitLifecycleEvent(sandbox.id, "Sandbox stopped");
      return json(updated);
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/exec", "POST");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (!sandbox.provider_sandbox_id) {
        return error("Sandbox has no provider instance", 400);
      }

      const { command } = await body<{ command: string }>(req);
      const session = createSession({ sandbox_id: sandbox.id, command });
      const collector = createStreamCollector(sandbox.id, session.id);
      const provider = await getProvider(sandbox.provider);

      const result = await provider.exec(sandbox.provider_sandbox_id, command, {
        onStdout: collector.onStdout,
        onStderr: collector.onStderr,
      });

      if ("exit_code" in result) {
        endSession(session.id, result.exit_code);
        return json({ session_id: session.id, ...result });
      }

      return json({ session_id: session.id, status: "running" });
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/keep-alive", "POST");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (!sandbox.provider_sandbox_id) {
        return error("Sandbox has no provider instance", 400);
      }
      const { duration_seconds } = await body<{ duration_seconds?: number }>(req);
      const provider = await getProvider(sandbox.provider);
      await provider.keepAlive(sandbox.provider_sandbox_id, (duration_seconds || 300) * 1000);
      return json({ ok: true });
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/logs", "GET");
  if (params) {
    const sessionId = url.searchParams.get("session_id") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const events = listEvents({
      sandbox_id: params["id"],
      session_id: sessionId,
      limit,
    });
    return json(events);
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/sessions", "GET");
  if (params) {
    const sessions = listSessions({ sandbox_id: params["id"] });
    return json(sessions);
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/files", "GET");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (!sandbox.provider_sandbox_id) return error("No provider instance", 400);
      const path = url.searchParams.get("path") || "/";
      const provider = await getProvider(sandbox.provider);
      const files = await provider.listFiles(sandbox.provider_sandbox_id, path);
      return json(files);
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  // ── Agents ─────────────────────────────────────────────────────────

  if (pathname === "/api/agents" && method === "GET") {
    return json(listAgents());
  }

  if (pathname === "/api/agents" && method === "POST") {
    try {
      const input = await body<{ name: string; description?: string }>(req);
      return json(registerAgent(input), 201);
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  // ── Projects ───────────────────────────────────────────────────────

  if (pathname === "/api/projects" && method === "GET") {
    return json(listProjects());
  }

  if (pathname === "/api/projects" && method === "POST") {
    try {
      const input = await body<{ name: string; path: string; description?: string }>(req);
      return json(ensureProject(input.name, input.path), 201);
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  // ── Webhooks ───────────────────────────────────────────────────────

  if (pathname === "/api/webhooks" && method === "GET") {
    return json(listWebhooks());
  }

  if (pathname === "/api/webhooks" && method === "POST") {
    try {
      const input = await body<{ url: string; events?: string[]; secret?: string }>(req);
      return json(createWebhook(input), 201);
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  params = matchRoute(pathname, method, "/api/webhooks/:id", "DELETE");
  if (params) {
    try {
      deleteWebhook(params["id"]!);
      return json({ ok: true });
    } catch (err) {
      return error((err as Error).message, 500);
    }
  }

  // ── SSE streaming ───────────────────────────────────────────────────

  params = matchRoute(pathname, method, "/api/sandboxes/:id/stream", "GET");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const send = (type: string, data: string) => {
            controller.enqueue(
              encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          };

          const removeListener = addStreamListener(sandbox.id, (type, data) => {
            send(type, data);
          });

          // Send heartbeat every 30s to keep connection alive
          const heartbeat = setInterval(() => {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          }, 30_000);

          // Cleanup on close
          const cleanup = () => {
            removeListener();
            clearInterval(heartbeat);
          };

          // AbortSignal doesn't exist on ReadableStream controller,
          // so we rely on the client disconnecting
          setTimeout(() => {
            cleanup();
            try { controller.close(); } catch { /* already closed */ }
          }, 3600_000); // 1 hour max
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      return error((err as Error).message, 404);
    }
  }

  return error("Not found", 404);
}

export function startServer(port: number): void {
  const server = Bun.serve({
    port,
    fetch: handleRequest,
  });

  console.log(`sandboxes-serve listening on http://localhost:${server.port}`);
}
