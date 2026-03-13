import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "./database.js";
import {
  createWebhook,
  getWebhook,
  listWebhooks,
  deleteWebhook,
} from "./webhooks.js";
import { WebhookNotFoundError } from "../types/index.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("createWebhook", () => {
  it("creates a webhook with required fields", () => {
    const wh = createWebhook({ url: "https://example.com/hook" });
    expect(wh.id).toBeTruthy();
    expect(wh.url).toBe("https://example.com/hook");
    expect(wh.events).toEqual([]);
    expect(wh.active).toBe(true);
    expect(wh.created_at).toBeTruthy();
  });

  it("generates a secret automatically when not provided", () => {
    const wh = createWebhook({ url: "https://example.com/hook" });
    expect(wh.secret).toBeTruthy();
    expect(wh.secret!.length).toBe(64); // 32 bytes hex = 64 chars
  });

  it("uses provided secret", () => {
    const wh = createWebhook({
      url: "https://example.com/hook",
      secret: "my-secret",
    });
    expect(wh.secret).toBe("my-secret");
  });

  it("stores events array", () => {
    const wh = createWebhook({
      url: "https://example.com/hook",
      events: ["sandbox.created", "sandbox.deleted"],
    });
    expect(wh.events).toEqual(["sandbox.created", "sandbox.deleted"]);
  });
});

describe("getWebhook", () => {
  it("retrieves a webhook by full ID", () => {
    const created = createWebhook({ url: "https://example.com/hook" });
    const fetched = getWebhook(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.url).toBe("https://example.com/hook");
  });

  it("retrieves a webhook by partial ID", () => {
    const created = createWebhook({ url: "https://example.com/hook" });
    const prefix = created.id.slice(0, 8);
    const fetched = getWebhook(prefix);
    expect(fetched.id).toBe(created.id);
  });

  it("throws WebhookNotFoundError for unknown ID", () => {
    expect(() => getWebhook("nonexistent")).toThrow(WebhookNotFoundError);
  });
});

describe("listWebhooks", () => {
  it("returns all webhooks", () => {
    createWebhook({ url: "https://a.com/hook" });
    createWebhook({ url: "https://b.com/hook" });
    const list = listWebhooks();
    expect(list).toHaveLength(2);
  });

  it("returns empty array when none exist", () => {
    const list = listWebhooks();
    expect(list).toEqual([]);
  });

  it("returns all webhooks in list", () => {
    createWebhook({ url: "https://a.com/hook" });
    createWebhook({ url: "https://b.com/hook" });
    const list = listWebhooks();
    const urls = list.map((w) => w.url).sort();
    expect(urls).toEqual(["https://a.com/hook", "https://b.com/hook"]);
  });
});

describe("deleteWebhook", () => {
  it("deletes a webhook", () => {
    const wh = createWebhook({ url: "https://example.com/hook" });
    deleteWebhook(wh.id);
    expect(() => getWebhook(wh.id)).toThrow(WebhookNotFoundError);
  });

  it("throws WebhookNotFoundError for unknown ID", () => {
    expect(() => deleteWebhook("nonexistent")).toThrow(WebhookNotFoundError);
  });
});
