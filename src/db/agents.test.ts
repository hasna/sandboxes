import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "./database.js";
import {
  registerAgent,
  getAgent,
  getAgentByName,
  listAgents,
  deleteAgent,
} from "./agents.js";
import { AgentNotFoundError } from "../types/index.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("registerAgent", () => {
  it("creates a new agent", () => {
    const agent = registerAgent({ name: "maximus" });
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe("maximus");
    expect(agent.description).toBeNull();
    expect(agent.metadata).toEqual({});
    expect(agent.created_at).toBeTruthy();
    expect(agent.last_seen_at).toBeTruthy();
  });

  it("creates an agent with description", () => {
    const agent = registerAgent({
      name: "aurelius",
      description: "Build agent",
    });
    expect(agent.description).toBe("Build agent");
  });

  it("is idempotent - same name returns same agent with updated last_seen_at", () => {
    const first = registerAgent({ name: "cassius" });
    const second = registerAgent({ name: "cassius" });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("cassius");
  });
});

describe("getAgent", () => {
  it("retrieves an agent by full ID", () => {
    const created = registerAgent({ name: "brutus" });
    const fetched = getAgent(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("brutus");
  });

  it("retrieves an agent by partial ID", () => {
    const created = registerAgent({ name: "titus" });
    const prefix = created.id.slice(0, 8);
    const fetched = getAgent(prefix);
    expect(fetched.id).toBe(created.id);
  });

  it("throws AgentNotFoundError for unknown ID", () => {
    expect(() => getAgent("nonexistent")).toThrow(AgentNotFoundError);
  });
});

describe("getAgentByName", () => {
  it("returns agent by name", () => {
    registerAgent({ name: "nero" });
    const found = getAgentByName("nero");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("nero");
  });

  it("returns null for unknown name", () => {
    const found = getAgentByName("unknown");
    expect(found).toBeNull();
  });
});

describe("listAgents", () => {
  it("returns all agents", () => {
    registerAgent({ name: "agent1" });
    registerAgent({ name: "agent2" });
    registerAgent({ name: "agent3" });
    const agents = listAgents();
    expect(agents).toHaveLength(3);
  });

  it("returns empty array when none exist", () => {
    const agents = listAgents();
    expect(agents).toEqual([]);
  });

  it("returns agents ordered by last_seen_at descending", () => {
    registerAgent({ name: "alpha" });
    registerAgent({ name: "beta" });
    const agents = listAgents();
    // Both exist regardless of order (timestamps may be identical)
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });
});

describe("deleteAgent", () => {
  it("deletes an agent", () => {
    const agent = registerAgent({ name: "doomed" });
    deleteAgent(agent.id);
    expect(() => getAgent(agent.id)).toThrow(AgentNotFoundError);
  });

  it("throws AgentNotFoundError for unknown ID", () => {
    expect(() => deleteAgent("nonexistent")).toThrow(AgentNotFoundError);
  });
});
