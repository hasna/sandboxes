import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "../db/database.js";
import { createSandbox } from "../db/sandboxes.js";
import { registerAgent, listAgents } from "../db/agents.js";
import { ensureProject, listProjects } from "../db/projects.js";
import { listEvents, addEvent } from "../db/events.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("MCP tool logic (unit)", () => {
  it("create_sandbox creates a DB record", () => {
    const sandbox = createSandbox({ provider: "e2b" });
    expect(sandbox.id).toBeDefined();
    expect(sandbox.provider).toBe("e2b");
    expect(sandbox.status).toBe("creating");
  });

  it("register_agent is idempotent", () => {
    const a1 = registerAgent({ name: "titus" });
    const a2 = registerAgent({ name: "titus" });
    expect(a1.name).toBe("titus");
    expect(a2.name).toBe("titus");
    expect(listAgents().length).toBe(1);
  });

  it("register_project via ensureProject", () => {
    const p1 = ensureProject("test", "/tmp/test");
    const p2 = ensureProject("test", "/tmp/test");
    expect(p1.id).toBe(p2.id);
    expect(listProjects().length).toBe(1);
  });

  it("get_logs returns events", () => {
    const sandbox = createSandbox({ provider: "e2b" });
    addEvent({ sandbox_id: sandbox.id, type: "stdout", data: "hello" });
    addEvent({ sandbox_id: sandbox.id, type: "stderr", data: "oops" });

    const events = listEvents({ sandbox_id: sandbox.id });
    expect(events.length).toBe(2);
    expect(events[0]!.type).toBe("stdout");
    expect(events[0]!.data).toBe("hello");
  });
});
