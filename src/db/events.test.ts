import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "./database.js";
import { createSandbox } from "./sandboxes.js";
import { createSession } from "./sessions.js";
import { addEvent, listEvents } from "./events.js";

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

describe("addEvent", () => {
  it("adds an event with required fields", () => {
    const event = addEvent({ sandbox_id: sandboxId, type: "stdout" });
    expect(event.id).toBeTruthy();
    expect(event.sandbox_id).toBe(sandboxId);
    expect(event.type).toBe("stdout");
    expect(event.session_id).toBeNull();
    expect(event.data).toBeNull();
    expect(event.created_at).toBeTruthy();
  });

  it("adds an event with all fields", () => {
    const session = createSession({ sandbox_id: sandboxId });
    const event = addEvent({
      sandbox_id: sandboxId,
      session_id: session.id,
      type: "stderr",
      data: "error output",
    });
    expect(event.session_id).toBe(session.id);
    expect(event.type).toBe("stderr");
    expect(event.data).toBe("error output");
  });

  it("supports all event types", () => {
    for (const type of ["stdout", "stderr", "lifecycle", "agent"] as const) {
      const event = addEvent({ sandbox_id: sandboxId, type });
      expect(event.type).toBe(type);
    }
  });
});

describe("listEvents", () => {
  it("filters by sandbox_id", () => {
    const sb2 = createSandbox({ provider: "e2b" });
    addEvent({ sandbox_id: sandboxId, type: "stdout", data: "hello" });
    addEvent({ sandbox_id: sandboxId, type: "stdout", data: "world" });
    addEvent({ sandbox_id: sb2.id, type: "stdout", data: "other" });

    const events = listEvents({ sandbox_id: sandboxId });
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.sandbox_id).toBe(sandboxId);
    }
  });

  it("filters by type", () => {
    addEvent({ sandbox_id: sandboxId, type: "stdout", data: "out" });
    addEvent({ sandbox_id: sandboxId, type: "stderr", data: "err" });
    addEvent({ sandbox_id: sandboxId, type: "lifecycle", data: "started" });

    const stderr = listEvents({ type: "stderr" });
    expect(stderr).toHaveLength(1);
    expect(stderr[0]!.data).toBe("err");
  });

  it("supports pagination with limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      addEvent({ sandbox_id: sandboxId, type: "stdout", data: `line-${i}` });
    }

    const page1 = listEvents({ sandbox_id: sandboxId, limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);
    expect(page1[0]!.data).toBe("line-0");
    expect(page1[1]!.data).toBe("line-1");

    const page2 = listEvents({ sandbox_id: sandboxId, limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);
    expect(page2[0]!.data).toBe("line-2");
    expect(page2[1]!.data).toBe("line-3");

    const page3 = listEvents({ sandbox_id: sandboxId, limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);
    expect(page3[0]!.data).toBe("line-4");
  });

  it("returns all events with no filter (up to default limit)", () => {
    addEvent({ sandbox_id: sandboxId, type: "stdout" });
    addEvent({ sandbox_id: sandboxId, type: "stderr" });
    const all = listEvents();
    expect(all).toHaveLength(2);
  });

  it("orders events by created_at ascending", () => {
    addEvent({ sandbox_id: sandboxId, type: "stdout", data: "first" });
    addEvent({ sandbox_id: sandboxId, type: "stdout", data: "second" });
    const events = listEvents({ sandbox_id: sandboxId });
    expect(events[0]!.data).toBe("first");
    expect(events[1]!.data).toBe("second");
  });
});
