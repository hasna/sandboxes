import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import pg from "pg";
import {
  SANDBOXES_STORAGE_CONFIG_ENV,
  getStorageConfig,
  getStorageConnectionString,
} from "./storage-config.js";
import {
  getStorageStatus,
  getStorageStatusWithRemoteCheck,
  hasSyncBatchErrors,
  parseStorageTables,
  STORAGE_TABLES,
} from "./storage-sync.js";
import { buildPgPoolConfig, isLocalPostgresHost } from "./remote-storage.js";

const envKeys = [
  "HASNA_SANDBOXES_DATABASE_URL",
  "SANDBOXES_DATABASE_URL",
  "HASNA_SANDBOXES_STORAGE_MODE",
  "SANDBOXES_STORAGE_MODE",
  SANDBOXES_STORAGE_CONFIG_ENV,
  "PGHOST",
  "PGSSLMODE",
] as const;

const savedEnv = new Map<string, string | undefined>();

function inspectClientParameters(connectionString: string): { host?: string; ssl?: unknown } {
  const client = new pg.Client(buildPgPoolConfig(connectionString));
  const params = (client as unknown as { connectionParameters: { host?: string; ssl?: unknown } }).connectionParameters;
  return {
    host: params.host,
    ssl: params.ssl,
  };
}

beforeEach(() => {
  savedEnv.clear();
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("sandboxes storage sync config", () => {
  test("canonical storage database env wins over fallback env", () => {
    process.env.HASNA_SANDBOXES_DATABASE_URL = "postgres://new.example/sandboxes";
    process.env.SANDBOXES_DATABASE_URL = "postgres://fallback.example/sandboxes";

    expect(getStorageConnectionString()).toBe("postgres://new.example/sandboxes");
    expect(getStorageConfig().mode).toBe("hybrid");
  });

  test("fallback storage database env is accepted", () => {
    process.env.SANDBOXES_DATABASE_URL = "postgres://fallback.example/sandboxes";

    expect(getStorageConnectionString()).toBe("postgres://fallback.example/sandboxes");
    expect(getStorageConfig().mode).toBe("hybrid");
  });

  test("canonical storage mode wins over fallback mode", () => {
    process.env.HASNA_SANDBOXES_STORAGE_MODE = "remote";
    process.env.SANDBOXES_STORAGE_MODE = "hybrid";

    expect(getStorageConfig().mode).toBe("remote");
  });

  test("config-file-shaped postgres settings count as configured", () => {
    process.env[SANDBOXES_STORAGE_CONFIG_ENV] = JSON.stringify({
      postgres: {
        host: "db.example.com",
        username: "sandboxes",
        password_env: "SANDBOXES_DATABASE_PASSWORD",
      },
    });

    const config = getStorageConfig();
    expect(config.mode).toBe("hybrid");
    expect(getStorageStatus().configured).toBe(true);
  });

  test("remote mode without database config is not enabled", () => {
    process.env.HASNA_SANDBOXES_STORAGE_MODE = "remote";

    const status = getStorageStatus();

    expect(status.configured).toBe(false);
    expect(status.enabled).toBe(false);
    expect(status.mode).toBe("remote");
  });

  test("remote status check reports unconfigured without network access", async () => {
    process.env.HASNA_SANDBOXES_STORAGE_MODE = "remote";

    const status = await getStorageStatusWithRemoteCheck();

    expect(status.remote).toEqual({
      checked: false,
      ok: false,
      error: "Remote storage is not configured",
    });
  });

  test("sync result helpers detect partial table errors", () => {
    const result = [{ table: "projects", direction: "push" as const, rowsRead: 1, rowsWritten: 0, errors: ["conflict"] }];

    expect(hasSyncBatchErrors(result)).toBe(true);
    expect(hasSyncBatchErrors({ push: result, pull: [] })).toBe(true);
    expect(hasSyncBatchErrors([{ ...result[0]!, errors: [] }])).toBe(false);
  });

  test("resolves storage tables", () => {
    expect(parseStorageTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("feedback")).toEqual(["feedback"]);
    expect(() => parseStorageTables("missing")).toThrow("Unknown sandboxes sync table");
  });

  test("verifies TLS for remote PostgreSQL by default", () => {
    expect(inspectClientParameters("postgres://user:pass@db.example.com/sandboxes")).toMatchObject({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
    expect(buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes")).toMatchObject({
      connectionString: "postgres://user:pass@db.example.com/sandboxes",
      ssl: { rejectUnauthorized: true },
    });
  });

  test("verifies TLS for exact remote SSL request forms", () => {
    expect(buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?sslmode=require")).toMatchObject({
      connectionString: "postgres://user:pass@db.example.com/sandboxes",
      ssl: { rejectUnauthorized: true },
    });
    expect(buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?ssl=true")).toMatchObject({
      connectionString: "postgres://user:pass@db.example.com/sandboxes",
      ssl: { rejectUnauthorized: true },
    });
    expect(inspectClientParameters("postgres://user:pass@db.example.com/sandboxes?sslmode=require")).toMatchObject({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
    expect(inspectClientParameters("postgres://user:pass@db.example.com/sandboxes?ssl=true")).toMatchObject({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
  });

  test("allows local PostgreSQL without TLS", () => {
    expect(isLocalPostgresHost("localhost")).toBe(true);
    expect(isLocalPostgresHost("%2Fvar%2Frun%2Fpostgresql")).toBe(true);
    expect(buildPgPoolConfig("postgres://user:pass@localhost/sandboxes")).toMatchObject({
      connectionString: "postgres://user:pass@localhost/sandboxes",
      ssl: undefined,
    });
  });

  test("allows local PostgreSQL to request verified TLS", () => {
    expect(inspectClientParameters("postgres://user:pass@localhost/sandboxes?sslmode=require")).toMatchObject({
      host: "localhost",
      ssl: { rejectUnauthorized: true },
    });
  });

  test("rejects remote PostgreSQL when TLS is explicitly disabled", () => {
    expect(() => buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?sslmode=disable")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?ssl=false")).toThrow("TLS disabled");
  });

  test("enforces TLS for remote query host overrides", () => {
    expect(inspectClientParameters("postgres://user:pass@localhost/sandboxes?host=db.example.com")).toMatchObject({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
    expect(inspectClientParameters("postgres://user:pass@localhost/sandboxes?host=localhost&host=db.example.com")).toMatchObject({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
    expect(() => buildPgPoolConfig("postgres://user:pass@localhost/sandboxes?host=db.example.com&sslmode=disable")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@localhost/sandboxes?host=db.example.com&ssl=false")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?host=&sslmode=disable")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?hostaddr=&ssl=false")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?hostaddr=127.0.0.1&sslmode=disable")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?hostaddr=127.0.0.1&ssl=false")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?hostaddr=::1&sslmode=disable")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@localhost/sandboxes?host=localhost&host=db.example.com&sslmode=disable")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?host=&host=db.example.com&sslmode=disable")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres://user:pass@localhost/sandboxes?host=127.0.0.1&host=db.example.com&ssl=false")).toThrow("TLS disabled");
  });

  test("enforces TLS when a hostless PostgreSQL URL inherits remote PGHOST", () => {
    process.env.PGHOST = "db.example.com";
    process.env.PGSSLMODE = "disable";

    expect(inspectClientParameters("postgres:///sandboxes")).toMatchObject({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
    expect(() => buildPgPoolConfig("postgres:///sandboxes?sslmode=disable")).toThrow("TLS disabled");
    expect(() => buildPgPoolConfig("postgres:///sandboxes?host=&ssl=false")).toThrow("TLS disabled");
  });

  test("freezes hostless PostgreSQL URLs when duplicate host params end empty", () => {
    delete process.env.PGHOST;
    delete process.env.PGSSLMODE;

    const cfg = buildPgPoolConfig("postgres:///sandboxes?host=localhost&host=");
    process.env.PGHOST = "db.example.com";
    process.env.PGSSLMODE = "disable";

    const client = new pg.Client(cfg);
    expect(client.connectionParameters).toMatchObject({
      host: "localhost",
      ssl: false,
    });
    expect(cfg.connectionString).toBe("postgres:///sandboxes?host=localhost");
  });

  test("freezes hostless PostgreSQL URLs before later PGHOST changes", () => {
    delete process.env.PGHOST;
    delete process.env.PGSSLMODE;

    const defaultLocal = buildPgPoolConfig("postgres:///sandboxes");
    process.env.PGHOST = "db.example.com";
    process.env.PGSSLMODE = "disable";

    const localClient = new pg.Client(defaultLocal);
    expect(localClient.connectionParameters).toMatchObject({
      host: "localhost",
      ssl: false,
    });

    process.env.PGHOST = "db.example.com";
    process.env.PGSSLMODE = "disable";
    const remote = buildPgPoolConfig("postgres:///sandboxes");
    process.env.PGHOST = "localhost";
    process.env.PGSSLMODE = "disable";

    const remoteClient = new pg.Client(remote);
    expect(remoteClient.connectionParameters).toMatchObject({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
  });

  test("allows a hostless PostgreSQL URL to inherit local PGHOST without TLS", () => {
    process.env.PGHOST = "/var/run/postgresql";
    process.env.PGSSLMODE = "disable";

    expect(inspectClientParameters("postgres:///sandboxes")).toMatchObject({
      host: "/var/run/postgresql",
      ssl: false,
    });
    expect(buildPgPoolConfig("postgres:///sandboxes?sslmode=disable")).toMatchObject({
      connectionString: "postgres:///sandboxes?host=%2Fvar%2Frun%2Fpostgresql",
      ssl: undefined,
    });
  });

  test("treats remote no-verify mode as verified TLS", () => {
    expect(inspectClientParameters("postgres://user:pass@db.example.com/sandboxes?sslmode=no-verify")).toMatchObject({
      host: "db.example.com",
      ssl: { rejectUnauthorized: true },
    });
  });

  test("preserves non-mode SSL parameters while enforcing verification", () => {
    expect(buildPgPoolConfig("postgres://user:pass@db.example.com/sandboxes?sslrootcert=/tmp/ca.pem")).toMatchObject({
      connectionString: "postgres://user:pass@db.example.com/sandboxes?sslrootcert=%2Ftmp%2Fca.pem",
      ssl: { rejectUnauthorized: true },
    });
  });
});
