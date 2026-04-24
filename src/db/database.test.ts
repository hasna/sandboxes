import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  resetDatabase,
  getDatabase,
  closeDatabase,
  uuid,
  shortId,
  now,
  resolvePartialId,
} from "./database.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("getDatabase", () => {
  it("returns a Database instance", () => {
    const db = getDatabase();
    expect(db).toBeInstanceOf(Database);
  });

  it("returns the same instance on subsequent calls", () => {
    const db1 = getDatabase();
    const db2 = getDatabase();
    expect(db1).toBe(db2);
  });
});

describe("migrations", () => {
  it("creates all expected tables", () => {
    const db = getDatabase();
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual([
      "_migrations",
      "agents",
      "feedback",
      "projects",
      "sandbox_events",
      "sandbox_sessions",
      "sandboxes",
      "snapshots",
      "templates",
      "webhooks",
    ]);
  });

  it("records all migrations as applied", () => {
    const db = getDatabase();
    const rows = db.query("SELECT id FROM _migrations ORDER BY id").all() as {
      id: number;
    }[];
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("is idempotent when called multiple times", () => {
    const db = getDatabase();
    // Close and reopen — migrations should not fail
    closeDatabase();
    process.env["SANDBOXES_DB_PATH"] = ":memory:";
    resetDatabase();
    const db2 = getDatabase();
    expect(db2).toBeInstanceOf(Database);
  });
});

describe("uuid", () => {
  it("returns a valid UUID v4 string", () => {
    const id = uuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });
});

describe("shortId", () => {
  it("returns an 8-character string", () => {
    const id = shortId();
    expect(id).toHaveLength(8);
  });
});

describe("now", () => {
  it("returns an ISO-ish datetime string without T and Z", () => {
    const ts = now();
    // Format: "2024-01-15 12:30:45.123"
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(ts).not.toContain("T");
    expect(ts).not.toContain("Z");
  });
});

describe("resolvePartialId", () => {
  it("resolves a full ID", () => {
    const db = getDatabase();
    const id = uuid();
    db.query("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(id, "test-agent");

    const resolved = resolvePartialId("agents", id);
    expect(resolved).toBe(id);
  });

  it("resolves a partial ID prefix", () => {
    const db = getDatabase();
    const id = uuid();
    db.query("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(id, "test-agent");

    const prefix = id.slice(0, 8);
    const resolved = resolvePartialId("agents", prefix);
    expect(resolved).toBe(id);
  });

  it("returns null when no match found", () => {
    const resolved = resolvePartialId("agents", "nonexistent-id");
    expect(resolved).toBeNull();
  });

  it("returns null for ambiguous partial IDs", () => {
    const db = getDatabase();
    // Insert two agents with same prefix by crafting IDs
    const id1 = "aaaa0000-0000-4000-a000-000000000001";
    const id2 = "aaaa0000-0000-4000-a000-000000000002";
    db.query("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(id1, "agent1");
    db.query("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(id2, "agent2");

    // "aaaa" matches both — ambiguous
    const resolved = resolvePartialId("agents", "aaaa");
    expect(resolved).toBeNull();
  });

  it("returns exact match when ambiguous prefix has an exact hit", () => {
    const db = getDatabase();
    const id1 = "aaaa";
    const id2 = "aaaa0000-0000-4000-a000-000000000002";
    db.query("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(id1, "agent1");
    db.query("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(id2, "agent2");

    const resolved = resolvePartialId("agents", "aaaa");
    expect(resolved).toBe("aaaa");
  });
});
