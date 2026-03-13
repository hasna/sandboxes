import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "../db/database.js";
import { createSandbox } from "../db/sandboxes.js";
import { registerAgent } from "../db/agents.js";
import { ensureProject } from "../db/projects.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

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
});
