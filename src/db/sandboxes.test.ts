import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "./database.js";
import {
  createSandbox,
  getSandbox,
  listSandboxes,
  updateSandbox,
  deleteSandbox,
} from "./sandboxes.js";
import { SandboxNotFoundError } from "../types/index.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("createSandbox", () => {
  it("creates a sandbox with defaults", () => {
    const sb = createSandbox({});
    expect(sb.id).toBeTruthy();
    expect(sb.provider).toBe("e2b");
    expect(sb.status).toBe("creating");
    expect(sb.name).toBeNull();
    expect(sb.image).toBeNull();
    expect(sb.timeout).toBe(3600);
    expect(sb.config).toEqual({});
    expect(sb.env_vars).toEqual({});
    expect(sb.project_id).toBeNull();
    expect(sb.created_at).toBeTruthy();
    expect(sb.updated_at).toBeTruthy();
  });

  it("creates a sandbox with all fields", () => {
    const sb = createSandbox({
      provider: "daytona",
      name: "my-sandbox",
      image: "ubuntu:22.04",
      timeout: 7200,
      config: { cpu: 2 },
      env_vars: { NODE_ENV: "test" },
    });
    expect(sb.provider).toBe("daytona");
    expect(sb.name).toBe("my-sandbox");
    expect(sb.image).toBe("ubuntu:22.04");
    expect(sb.timeout).toBe(7200);
    expect(sb.config).toEqual({ cpu: 2 });
    expect(sb.env_vars).toEqual({ NODE_ENV: "test" });
  });
});

describe("getSandbox", () => {
  it("retrieves a sandbox by full ID", () => {
    const created = createSandbox({ name: "test" });
    const fetched = getSandbox(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("test");
  });

  it("retrieves a sandbox by partial ID", () => {
    const created = createSandbox({ name: "partial-test" });
    const prefix = created.id.slice(0, 8);
    const fetched = getSandbox(prefix);
    expect(fetched.id).toBe(created.id);
  });

  it("throws SandboxNotFoundError for unknown ID", () => {
    expect(() => getSandbox("nonexistent")).toThrow(SandboxNotFoundError);
  });
});

describe("listSandboxes", () => {
  it("returns all sandboxes with no filter", () => {
    createSandbox({});
    createSandbox({});
    const list = listSandboxes();
    expect(list).toHaveLength(2);
  });

  it("filters by status", () => {
    const sb = createSandbox({});
    updateSandbox(sb.id, { status: "running" });
    createSandbox({});

    const running = listSandboxes({ status: "running" });
    expect(running).toHaveLength(1);
    expect(running[0]!.status).toBe("running");

    const creating = listSandboxes({ status: "creating" });
    expect(creating).toHaveLength(1);
  });

  it("filters by provider", () => {
    createSandbox({ provider: "e2b" });
    createSandbox({ provider: "daytona" });
    createSandbox({ provider: "e2b" });

    const e2b = listSandboxes({ provider: "e2b" });
    expect(e2b).toHaveLength(2);

    const daytona = listSandboxes({ provider: "daytona" });
    expect(daytona).toHaveLength(1);
  });

  it("returns empty array when no matches", () => {
    const list = listSandboxes({ status: "running" });
    expect(list).toEqual([]);
  });
});

describe("updateSandbox", () => {
  it("updates status", () => {
    const sb = createSandbox({});
    const updated = updateSandbox(sb.id, { status: "running" });
    expect(updated.status).toBe("running");
  });

  it("updates multiple fields", () => {
    const sb = createSandbox({});
    const updated = updateSandbox(sb.id, {
      status: "running",
      name: "renamed",
      timeout: 9999,
      config: { memory: "4g" },
      env_vars: { FOO: "bar" },
      provider_sandbox_id: "ext-123",
      keep_alive_until: "2099-01-01 00:00:00",
    });
    expect(updated.status).toBe("running");
    expect(updated.name).toBe("renamed");
    expect(updated.timeout).toBe(9999);
    expect(updated.config).toEqual({ memory: "4g" });
    expect(updated.env_vars).toEqual({ FOO: "bar" });
    expect(updated.provider_sandbox_id).toBe("ext-123");
    expect(updated.keep_alive_until).toBe("2099-01-01 00:00:00");
  });

  it("returns unchanged sandbox when no updates given", () => {
    const sb = createSandbox({ name: "unchanged" });
    const updated = updateSandbox(sb.id, {});
    expect(updated.name).toBe("unchanged");
  });

  it("throws SandboxNotFoundError for unknown ID", () => {
    expect(() => updateSandbox("nonexistent", { status: "running" })).toThrow(
      SandboxNotFoundError
    );
  });
});

describe("deleteSandbox", () => {
  it("deletes a sandbox", () => {
    const sb = createSandbox({});
    deleteSandbox(sb.id);
    expect(() => getSandbox(sb.id)).toThrow(SandboxNotFoundError);
  });

  it("throws SandboxNotFoundError for unknown ID", () => {
    expect(() => deleteSandbox("nonexistent")).toThrow(SandboxNotFoundError);
  });
});
