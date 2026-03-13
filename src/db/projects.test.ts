import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, getDatabase, closeDatabase } from "./database.js";
import {
  createProject,
  getProject,
  getProjectByPath,
  ensureProject,
  listProjects,
  deleteProject,
} from "./projects.js";
import { ProjectNotFoundError } from "../types/index.js";

beforeEach(() => {
  process.env["SANDBOXES_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["SANDBOXES_DB_PATH"];
});

describe("createProject", () => {
  it("creates a project with required fields", () => {
    const project = createProject({ name: "my-project", path: "/tmp/proj" });
    expect(project.id).toBeTruthy();
    expect(project.name).toBe("my-project");
    expect(project.path).toBe("/tmp/proj");
    expect(project.description).toBeNull();
    expect(project.created_at).toBeTruthy();
    expect(project.updated_at).toBeTruthy();
  });

  it("creates a project with description", () => {
    const project = createProject({
      name: "described",
      path: "/tmp/desc",
      description: "A test project",
    });
    expect(project.description).toBe("A test project");
  });

  it("enforces unique path constraint", () => {
    createProject({ name: "first", path: "/tmp/unique" });
    expect(() =>
      createProject({ name: "second", path: "/tmp/unique" })
    ).toThrow();
  });
});

describe("getProject", () => {
  it("retrieves a project by full ID", () => {
    const created = createProject({ name: "test", path: "/tmp/test" });
    const fetched = getProject(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("test");
  });

  it("retrieves a project by partial ID", () => {
    const created = createProject({ name: "partial", path: "/tmp/partial" });
    const prefix = created.id.slice(0, 8);
    const fetched = getProject(prefix);
    expect(fetched.id).toBe(created.id);
  });

  it("throws ProjectNotFoundError for unknown ID", () => {
    expect(() => getProject("nonexistent")).toThrow(ProjectNotFoundError);
  });
});

describe("getProjectByPath", () => {
  it("returns project by path", () => {
    createProject({ name: "by-path", path: "/tmp/by-path" });
    const found = getProjectByPath("/tmp/by-path");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("by-path");
  });

  it("returns null for unknown path", () => {
    const found = getProjectByPath("/tmp/nonexistent");
    expect(found).toBeNull();
  });
});

describe("ensureProject", () => {
  it("creates a new project if path does not exist", () => {
    const project = ensureProject("new-proj", "/tmp/new");
    expect(project.id).toBeTruthy();
    expect(project.name).toBe("new-proj");
    expect(project.path).toBe("/tmp/new");
  });

  it("returns existing project if path already exists", () => {
    const first = createProject({ name: "existing", path: "/tmp/existing" });
    const second = ensureProject("different-name", "/tmp/existing");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("existing"); // keeps original name
  });
});

describe("listProjects", () => {
  it("returns all projects", () => {
    createProject({ name: "p1", path: "/tmp/p1" });
    createProject({ name: "p2", path: "/tmp/p2" });
    const list = listProjects();
    expect(list).toHaveLength(2);
  });

  it("returns empty array when none exist", () => {
    const list = listProjects();
    expect(list).toEqual([]);
  });

  it("returns all projects in list", () => {
    createProject({ name: "alpha", path: "/tmp/alpha" });
    createProject({ name: "beta", path: "/tmp/beta" });
    const list = listProjects();
    const names = list.map((p) => p.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });
});

describe("deleteProject", () => {
  it("deletes a project", () => {
    const project = createProject({ name: "doomed", path: "/tmp/doomed" });
    deleteProject(project.id);
    expect(() => getProject(project.id)).toThrow(ProjectNotFoundError);
  });

  it("throws ProjectNotFoundError for unknown ID", () => {
    expect(() => deleteProject("nonexistent")).toThrow(ProjectNotFoundError);
  });
});
