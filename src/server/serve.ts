import {
  createSandbox as dbCreateSandbox,
  getSandbox,
  listSandboxes,
  updateSandbox,
  deleteSandbox as dbDeleteSandbox,
} from "../db/sandboxes.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createSession, listSessions } from "../db/sessions.js";
import { listEvents } from "../db/events.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { listProjects, ensureProject } from "../db/projects.js";
import { listWebhooks, createWebhook, deleteWebhook } from "../db/webhooks.js";
import { getProvider as resolveProvider } from "../providers/index.js";
import { getDefaultProvider, getDefaultTimeout } from "../lib/config.js";
import { createStreamCollector, emitLifecycleEvent } from "../lib/stream.js";
import {
  finalizeSandboxProvisionFailure,
  finalizeSessionExit,
  finalizeSessionFailure,
  getErrorMessage,
} from "../lib/runtime-state.js";
import { addStreamListener } from "../lib/stream.js";
import { getPackageVersion } from "../lib/version.js";
import { handleMcpHttpRoutes } from "../mcp/http.js";
import type { SandboxProviderName, CreateSandboxInput } from "../types/index.js";

const AUTH_TOKEN_ENV = ["HASNA_SANDBOXES_SERVE_TOKEN", "SANDBOXES_SERVE_TOKEN"] as const;
const ALLOWED_ORIGINS_ENV = [
  "HASNA_SANDBOXES_SERVE_ALLOWED_ORIGINS",
  "SANDBOXES_SERVE_ALLOWED_ORIGINS",
] as const;

type ProviderResolver = typeof resolveProvider;

export interface ServerSecurityOptions {
  token?: string;
  allowedOrigins?: string[];
  hostname?: string;
}

export interface RequestHandlerOptions extends ServerSecurityOptions {
  providerResolver?: ProviderResolver;
}

interface ResolvedServerSecurity {
  token?: string;
  allowedOrigins: Set<string>;
}

interface RequestContext {
  security: ResolvedServerSecurity;
  providerResolver: ProviderResolver;
}

function normalizedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readFirstEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = normalizedValue(process.env[name]);
    if (value) return value;
  }
  return undefined;
}

function splitOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveServerSecurity(options: ServerSecurityOptions = {}): ResolvedServerSecurity {
  const token = normalizedValue(options.token) ?? readFirstEnv(AUTH_TOKEN_ENV);
  const origins = options.allowedOrigins ?? splitOrigins(readFirstEnv(ALLOWED_ORIGINS_ENV));
  return {
    token,
    allowedOrigins: new Set(origins.map((origin) => origin.trim()).filter(Boolean)),
  };
}

function createContext(options: RequestHandlerOptions = {}): RequestContext {
  return {
    security: resolveServerSecurity(options),
    providerResolver: options.providerResolver ?? resolveProvider,
  };
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("Vary");
  if (!existing) {
    headers.set("Vary", value);
    return;
  }

  const values = existing.split(",").map((item) => item.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    headers.set("Vary", `${existing}, ${value}`);
  }
}

function isAllowedOrigin(req: Request, security: ResolvedServerSecurity): boolean {
  const origin = req.headers.get("Origin");
  return Boolean(origin && security.allowedOrigins.has(origin));
}

function applyCors(req: Request, security: ResolvedServerSecurity, headers: Headers): void {
  const origin = req.headers.get("Origin");
  if (!origin || !isAllowedOrigin(req, security)) return;

  headers.set("Access-Control-Allow-Origin", origin);
  appendVary(headers, "Origin");
}

function responseHeaders(
  req: Request,
  security: ResolvedServerSecurity,
  extra?: HeadersInit
): Headers {
  const headers = new Headers(extra);
  applyCors(req, security, headers);
  return headers;
}

function json(
  req: Request,
  context: RequestContext,
  data: unknown,
  status = 200,
  extraHeaders?: HeadersInit
): Response {
  const headers = responseHeaders(req, context.security, extraHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function error(
  req: Request,
  context: RequestContext,
  message: string,
  status = 400,
  extraHeaders?: HeadersInit
): Response {
  return json(req, context, { error: message }, status, extraHeaders);
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("Authorization");
  if (!header) return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

function tokenMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;

  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const actualBytes = encoder.encode(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function authorize(req: Request, context: RequestContext): Response | null {
  const expectedToken = context.security.token;
  if (!expectedToken) {
    return error(req, context, "sandboxes-serve auth token is not configured", 503);
  }

  if (!tokenMatches(expectedToken, bearerToken(req))) {
    return error(req, context, "Unauthorized", 401, {
      "WWW-Authenticate": 'Bearer realm="sandboxes-serve"',
    });
  }

  return null;
}

function isPublicRoute(pathname: string, method: string): boolean {
  return method === "GET" && (pathname === "/api/health" || pathname === "/health");
}

function handleCorsPreflight(req: Request, context: RequestContext): Response {
  const origin = req.headers.get("Origin");
  if (origin && !isAllowedOrigin(req, context.security)) {
    return error(req, context, "CORS origin is not allowed", 403);
  }

  const headers = responseHeaders(req, context.security);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    req.headers.get("Access-Control-Request-Headers") ?? "Authorization, Content-Type"
  );
  headers.set("Access-Control-Max-Age", "600");
  return new Response(null, { status: 204, headers });
}

function withCors(req: Request, context: RequestContext, response: Response): Response {
  const headers = new Headers(response.headers);
  applyCors(req, context.security, headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createRequestHandler(options: RequestHandlerOptions = {}): (req: Request) => Promise<Response> {
  const context = createContext(options);
  return (req: Request) => handleRequestWithContext(req, context);
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

export async function handleRequest(
  req: Request,
  options: RequestHandlerOptions = {}
): Promise<Response> {
  return handleRequestWithContext(req, createContext(options));
}

async function handleRequestWithContext(req: Request, context: RequestContext): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  if (method === "OPTIONS") {
    return handleCorsPreflight(req, context);
  }

  if (pathname === "/api/health" && method === "GET") {
    return json(req, context, { status: "ok", version: getPackageVersion() });
  }

  if (!isPublicRoute(pathname, method)) {
    const authResponse = authorize(req, context);
    if (authResponse) return authResponse;
  }

  const mcpResponse = await handleMcpHttpRoutes(req);
  if (mcpResponse) {
    return withCors(req, context, mcpResponse);
  }

  // ── Sandboxes ──────────────────────────────────────────────────────

  if (pathname === "/api/sandboxes" && method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    const provider = url.searchParams.get("provider") || undefined;
    const result = listSandboxes({
      status: status as "creating" | "running" | "paused" | "stopped" | "deleted" | "error" | undefined,
      provider: provider as SandboxProviderName,
    });
    return json(req, context, result);
  }

  if (pathname === "/api/sandboxes" && method === "POST") {
    let sandboxId: string | undefined;
    try {
      const input = await body<CreateSandboxInput>(req);
      const providerName = input.provider || getDefaultProvider();
      const timeout = input.timeout || getDefaultTimeout();

      const sandbox = dbCreateSandbox({ ...input, provider: providerName, timeout });
      sandboxId = sandbox.id;

      const provider = await context.providerResolver(providerName);
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
      return json(req, context, updated, 201);
    } catch (err) {
      const message = sandboxId ? finalizeSandboxProvisionFailure(sandboxId, err) : getErrorMessage(err);
      return error(req, context, message, 500);
    }
  }

  let params = matchRoute(pathname, method, "/api/sandboxes/:id", "GET");
  if (params) {
    try {
      return json(req, context, getSandbox(params["id"]!));
    } catch (err) {
      return error(req, context, (err as Error).message, 404);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id", "DELETE");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (sandbox.provider_sandbox_id) {
        const provider = await context.providerResolver(sandbox.provider);
        await provider.delete(sandbox.provider_sandbox_id);
      }
      dbDeleteSandbox(sandbox.id);
      emitLifecycleEvent(sandbox.id, "Sandbox deleted");
      return json(req, context, { ok: true });
    } catch (err) {
      return error(req, context, (err as Error).message, 500);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/stop", "POST");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (sandbox.provider_sandbox_id) {
        const provider = await context.providerResolver(sandbox.provider);
        await provider.stop(sandbox.provider_sandbox_id);
      }
      const updated = updateSandbox(sandbox.id, { status: "stopped" });
      emitLifecycleEvent(sandbox.id, "Sandbox stopped");
      return json(req, context, updated);
    } catch (err) {
      return error(req, context, (err as Error).message, 500);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/exec", "POST");
  if (params) {
    let sessionId: string | undefined;
    try {
      const sandbox = getSandbox(params["id"]!);
      if (!sandbox.provider_sandbox_id) {
        return error(req, context, "Sandbox has no provider instance", 400);
      }

      const { command } = await body<{ command: string }>(req);
      const session = createSession({ sandbox_id: sandbox.id, command });
      sessionId = session.id;
      const collector = createStreamCollector(sandbox.id, session.id);
      const provider = await context.providerResolver(sandbox.provider);

      const result = await provider.exec(sandbox.provider_sandbox_id, command, {
        onStdout: collector.onStdout,
        onStderr: collector.onStderr,
      });

      if ("exit_code" in result) {
        finalizeSessionExit(session.id, result.exit_code);
        return json(req, context, { session_id: session.id, ...result });
      }

      return json(req, context, { session_id: session.id, status: "running" });
    } catch (err) {
      if (sessionId) {
        finalizeSessionFailure(sessionId, err);
      }
      return error(req, context, getErrorMessage(err), 500);
    }
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/keep-alive", "POST");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (!sandbox.provider_sandbox_id) {
        return error(req, context, "Sandbox has no provider instance", 400);
      }
      const { duration_seconds } = await body<{ duration_seconds?: number }>(req);
      const provider = await context.providerResolver(sandbox.provider);
      await provider.keepAlive(sandbox.provider_sandbox_id, (duration_seconds || 300) * 1000);
      return json(req, context, { ok: true });
    } catch (err) {
      return error(req, context, (err as Error).message, 500);
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
    return json(req, context, events);
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/sessions", "GET");
  if (params) {
    const sessions = listSessions({ sandbox_id: params["id"] });
    return json(req, context, sessions);
  }

  params = matchRoute(pathname, method, "/api/sandboxes/:id/files", "GET");
  if (params) {
    try {
      const sandbox = getSandbox(params["id"]!);
      if (!sandbox.provider_sandbox_id) return error(req, context, "No provider instance", 400);
      const path = url.searchParams.get("path") || "/";
      const provider = await context.providerResolver(sandbox.provider);
      const files = await provider.listFiles(sandbox.provider_sandbox_id, path);
      return json(req, context, files);
    } catch (err) {
      return error(req, context, (err as Error).message, 500);
    }
  }

  // ── Agents ─────────────────────────────────────────────────────────

  if (pathname === "/api/agents" && method === "GET") {
    return json(req, context, listAgents());
  }

  if (pathname === "/api/agents" && method === "POST") {
    try {
      const input = await body<{ name: string; description?: string }>(req);
      return json(req, context, registerAgent(input), 201);
    } catch (err) {
      return error(req, context, (err as Error).message, 500);
    }
  }

  // ── Projects ───────────────────────────────────────────────────────

  if (pathname === "/api/projects" && method === "GET") {
    return json(req, context, listProjects());
  }

  if (pathname === "/api/projects" && method === "POST") {
    try {
      const input = await body<{ name: string; path: string; description?: string }>(req);
      return json(req, context, ensureProject(input.name, input.path, input.description), 201);
    } catch (err) {
      return error(req, context, (err as Error).message, 500);
    }
  }

  // ── Webhooks ───────────────────────────────────────────────────────

  if (pathname === "/api/webhooks" && method === "GET") {
    return json(req, context, listWebhooks());
  }

  if (pathname === "/api/webhooks" && method === "POST") {
    try {
      const input = await body<{ url: string; events?: string[]; secret?: string }>(req);
      return json(req, context, createWebhook(input), 201);
    } catch (err) {
      return error(req, context, (err as Error).message, 500);
    }
  }

  params = matchRoute(pathname, method, "/api/webhooks/:id", "DELETE");
  if (params) {
    try {
      deleteWebhook(params["id"]!);
      return json(req, context, { ok: true });
    } catch (err) {
      return error(req, context, (err as Error).message, 500);
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
        headers: responseHeaders(req, context.security, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        }),
      });
    } catch (err) {
      return error(req, context, (err as Error).message, 404);
    }
  }

  return error(req, context, "Not found", 404);
}

export function startServer(port: number, options: ServerSecurityOptions = {}): void {
  const configuredToken = normalizedValue(options.token) ?? readFirstEnv(AUTH_TOKEN_ENV);
  const token = configuredToken ?? randomUUID();
  const allowedOrigins = resolveServerSecurity(options).allowedOrigins;
  const hostname = normalizedValue(options.hostname) ?? "127.0.0.1";
  const handler = createRequestHandler({ ...options, token });
  const server = Bun.serve({
    hostname,
    port,
    fetch: handler,
  });

  console.log(`sandboxes-serve listening on http://${hostname}:${server.port}`);
  if (configuredToken) {
    console.log("sandboxes-serve API auth: using configured bearer token");
  } else {
    console.log(`sandboxes-serve generated one-time bearer token: ${token}`);
  }
  console.log("Send API requests with: Authorization: Bearer <token>");
  if (allowedOrigins.size === 0) {
    console.log("Browser CORS origins are disabled by default; set HASNA_SANDBOXES_SERVE_ALLOWED_ORIGINS to allow exact origins.");
  }
}
