import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "./database.js";
import { createSandbox } from "./sandboxes.js";
import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  endSession,
} from "./sessions.js";
import { SessionNotFoundError } from "../types/index.js";

let sandboxId: string;

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
  sandboxId = createSandbox({ provider: "e2b" }).id;
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("createSession", () => {
  it("creates a session with required fields", () => {
    const session = createSession({ sandbox_id: sandboxId });
    expect(session.id).toBeTruthy();
    expect(session.sandbox_id).toBe(sandboxId);
    expect(session.status).toBe("running");
    expect(session.agent_name).toBeNull();
    expect(session.agent_type).toBeNull();
    expect(session.command).toBeNull();
    expect(session.exit_code).toBeNull();
    expect(session.started_at).toBeTruthy();
    expect(session.ended_at).toBeNull();
  });

  it("creates a session with all optional fields", () => {
    const session = createSession({
      sandbox_id: sandboxId,
      agent_name: "maximus",
      agent_type: "claude",
      command: "npm test",
    });
    expect(session.agent_name).toBe("maximus");
    expect(session.agent_type).toBe("claude");
    expect(session.command).toBe("npm test");
  });
});

describe("getSession", () => {
  it("retrieves a session by ID", () => {
    const created = createSession({ sandbox_id: sandboxId });
    const fetched = getSession(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.sandbox_id).toBe(sandboxId);
  });

  it("throws SessionNotFoundError for unknown ID", () => {
    expect(() => getSession("nonexistent")).toThrow(SessionNotFoundError);
  });
});

describe("listSessions", () => {
  it("lists sessions by sandbox_id", () => {
    createSession({ sandbox_id: sandboxId });
    createSession({ sandbox_id: sandboxId });

    const sb2 = createSandbox({ provider: "e2b" });
    createSession({ sandbox_id: sb2.id });

    const list = listSessions({ sandbox_id: sandboxId });
    expect(list).toHaveLength(2);
    for (const s of list) {
      expect(s.sandbox_id).toBe(sandboxId);
    }
  });

  it("lists sessions by status", () => {
    const s1 = createSession({ sandbox_id: sandboxId });
    createSession({ sandbox_id: sandboxId });
    endSession(s1.id, 0, "completed");

    const running = listSessions({ status: "running" });
    expect(running).toHaveLength(1);

    const completed = listSessions({ status: "completed" });
    expect(completed).toHaveLength(1);
  });

  it("returns all sessions with no filter", () => {
    createSession({ sandbox_id: sandboxId });
    createSession({ sandbox_id: sandboxId });
    const all = listSessions();
    expect(all).toHaveLength(2);
  });
});

describe("updateSession", () => {
  it("updates status", () => {
    const session = createSession({ sandbox_id: sandboxId });
    const updated = updateSession(session.id, { status: "failed" });
    expect(updated.status).toBe("failed");
  });

  it("updates exit_code", () => {
    const session = createSession({ sandbox_id: sandboxId });
    const updated = updateSession(session.id, { exit_code: 1 });
    expect(updated.exit_code).toBe(1);
  });

  it("returns unchanged session when no updates given", () => {
    const session = createSession({ sandbox_id: sandboxId });
    const updated = updateSession(session.id, {});
    expect(updated.id).toBe(session.id);
    expect(updated.status).toBe("running");
  });
});

describe("endSession", () => {
  it("ends a session with exit code and default status", () => {
    const session = createSession({ sandbox_id: sandboxId });
    const ended = endSession(session.id, 0);
    expect(ended.status).toBe("completed");
    expect(ended.exit_code).toBe(0);
    expect(ended.ended_at).toBeTruthy();
  });

  it("ends a session with explicit status", () => {
    const session = createSession({ sandbox_id: sandboxId });
    const ended = endSession(session.id, 137, "killed");
    expect(ended.status).toBe("killed");
    expect(ended.exit_code).toBe(137);
    expect(ended.ended_at).toBeTruthy();
  });

  it("throws SessionNotFoundError for unknown ID", () => {
    expect(() => endSession("nonexistent", 0)).toThrow(SessionNotFoundError);
  });
});
