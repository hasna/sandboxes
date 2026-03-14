import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createSandbox, getSandbox } from "../db/sandboxes.js";
import { resetDatabase, getDatabase, closeDatabase } from "../db/database.js";
import { createSession, getSession } from "../db/sessions.js";
import {
  finalizeSandboxProvisionFailure,
  finalizeSessionExit,
  finalizeSessionFailure,
} from "./runtime-state.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("runtime-state", () => {
  it("marks provisioning failures as sandbox errors", () => {
    const sandbox = createSandbox({ provider: "e2b", name: "broken" });

    const message = finalizeSandboxProvisionFailure(sandbox.id, new Error("provider exploded"));

    expect(message).toBe("provider exploded");
    expect(getSandbox(sandbox.id).status).toBe("error");
  });

  it("marks non-zero exits as failed sessions", () => {
    const sandbox = createSandbox({ provider: "e2b" });
    const session = createSession({ sandbox_id: sandbox.id, command: "false" });

    finalizeSessionExit(session.id, 7);

    const updated = getSession(session.id);
    expect(updated.status).toBe("failed");
    expect(updated.exit_code).toBe(7);
    expect(updated.ended_at).toBeTruthy();
  });

  it("marks thrown execution errors as failed sessions", () => {
    const sandbox = createSandbox({ provider: "e2b" });
    const session = createSession({ sandbox_id: sandbox.id, command: "boom" });

    finalizeSessionFailure(session.id, new Error("kaboom"));

    const updated = getSession(session.id);
    expect(updated.status).toBe("failed");
    expect(updated.exit_code).toBe(1);
    expect(updated.ended_at).toBeTruthy();
  });
});
