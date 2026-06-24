import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "../db/database.js";
import { createSandbox } from "../db/sandboxes.js";
import { addEvent } from "../db/events.js";
import { createSnapshot } from "../db/snapshots.js";
import { truncateEncodedContent } from "../lib/compact-output.js";
import { buildServer } from "./server.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

async function callTool(name: string, args: Record<string, unknown>) {
  const server = buildServer() as any;
  const result = await server._registeredTools[name].handler(args);
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0].text);
}

describe("MCP compact output defaults", () => {
  it("returns paged compact sandbox summaries by default", async () => {
    for (let i = 0; i < 25; i++) {
      createSandbox({
        provider: "e2b",
        name: `sandbox-${i}`,
        env_vars: { SECRET_TOKEN: "should-not-appear" },
        config: { nested: { value: "large" } },
      });
    }

    const payload = await callTool("list_sandboxes", {});

    expect(payload.items).toHaveLength(20);
    expect(payload.total).toBe(25);
    expect(payload.next_cursor).toBe(20);
    expect(payload.items[0].env_vars).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("should-not-appear");
    expect(payload.hint).toContain("get_sandbox");
  });

  it("supports verbose sandbox detail when explicitly requested", async () => {
    const sandbox = createSandbox({
      provider: "e2b",
      name: "verbose",
      env_vars: { SECRET_TOKEN: "visible-when-verbose" },
      config: { mode: "debug" },
    });

    const compact = await callTool("get_sandbox", { id: sandbox.id });
    const verbose = await callTool("get_sandbox", { id: sandbox.id, verbose: true });

    expect(compact.env_vars.keys).toEqual(["SECRET_TOKEN"]);
    expect(JSON.stringify(compact)).not.toContain("visible-when-verbose");
    expect(verbose.env_vars.SECRET_TOKEN).toBe("visible-when-verbose");
  });

  it("truncates log payloads by default and exposes cursor pagination", async () => {
    const sandbox = createSandbox({ provider: "e2b" });
    addEvent({ sandbox_id: sandbox.id, type: "stdout", data: "x".repeat(1500) });
    addEvent({ sandbox_id: sandbox.id, type: "stderr", data: "short" });

    const payload = await callTool("get_logs", { sandbox_id: sandbox.id, limit: 1 });

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].data.length).toBeLessThan(1300);
    expect(payload.items[0].data_truncated).toBe(true);
    expect(payload.next_cursor).toBe(1);
    expect(payload.hint).toContain("verbose:true");
  });

  it("keeps get_agent_output offset compatibility fields", async () => {
    const sandbox = createSandbox({ provider: "e2b" });
    addEvent({ sandbox_id: sandbox.id, type: "stdout", data: "first" });
    addEvent({ sandbox_id: sandbox.id, type: "stdout", data: "second" });

    const payload = await callTool("get_agent_output", {
      sandbox_id: sandbox.id,
      offset: 1,
      limit: 1,
    });

    expect(payload.limit).toBe(1);
    expect(payload.cursor).toBe(1);
    expect(payload.event_count).toBe(1);
    expect(payload.next_cursor).toBe(2);
    expect(payload.next_offset).toBe(2);
  });

  it("returns full snapshot records when verbose is requested", async () => {
    createSnapshot({
      sandbox_id: "sandbox-id",
      provider_sandbox_id: "provider-sandbox-id",
      provider: "e2b",
      name: "checkpoint",
    });

    const compact = await callTool("list_snapshots", {});
    const verbose = await callTool("list_snapshots", { verbose: true });

    expect(compact.items[0].provider_sandbox_id).toBeUndefined();
    expect(verbose.items[0].provider_sandbox_id).toBe("provider-sandbox-id");
  });

  it("pages tool catalog output instead of dumping every tool by default", async () => {
    const payload = await callTool("describe_tools", { limit: 5 });

    expect(payload.items).toHaveLength(5);
    expect(payload.total).toBeGreaterThan(5);
    expect(payload.next_cursor).toBe(5);
  });

  it("truncates encoded file content without corrupting the encoding", () => {
    const base64 = Buffer.from("hello world from a sandbox file").toString("base64");
    const hex = Buffer.from("hello world from a sandbox file").toString("hex");

    const base64Output = truncateEncodedContent(base64, "base64", 10);
    const hexOutput = truncateEncodedContent(hex, "hex", 9);

    expect(base64Output.truncated).toBe(true);
    expect(base64Output.text).not.toContain("…");
    expect(base64Output.text.length % 4).toBe(0);
    expect(Buffer.from(base64Output.text, "base64").toString("utf8")).toBe("hello ");
    expect(hexOutput.truncated).toBe(true);
    expect(hexOutput.text).not.toContain("…");
    expect(hexOutput.text.length % 2).toBe(0);
    expect(Buffer.from(hexOutput.text, "hex").toString("utf8")).toBe("hell");
  });
});
