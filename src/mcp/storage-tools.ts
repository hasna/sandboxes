import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db/database.js";
import {
  getStorageStatus,
  getStorageStatusWithRemoteCheck,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  syncStorageChanges,
  hasSyncBatchErrors,
} from "../db/storage-sync.js";
import { getPackageVersion } from "../lib/version.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

function syncResult(data: unknown) {
  const result = ok(data);
  if (hasSyncBatchErrors(data as any)) {
    return { ...result, isError: true as const };
  }
  return result;
}

export function registerSandboxesStorageTools(server: McpServer): void {
  server.tool(
    "sandboxes_storage_status",
    "Show sandboxes local database and storage sync status",
    {
      check_remote: z.boolean().optional().describe("Check remote PostgreSQL connectivity when configured"),
    },
    async ({ check_remote }) => {
      try {
        return ok(check_remote ? await getStorageStatusWithRemoteCheck() : getStorageStatus());
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "sandboxes_storage_push",
    "Push local sandboxes data to PostgreSQL",
    {
      tables: z.string().optional().describe("Comma-separated table names"),
    },
    async ({ tables }) => {
      try {
        return syncResult(await pushStorageChanges(parseStorageTables(tables)));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "sandboxes_storage_pull",
    "Pull PostgreSQL sandboxes data into the local database",
    {
      tables: z.string().optional().describe("Comma-separated table names"),
    },
    async ({ tables }) => {
      try {
        return syncResult(await pullStorageChanges(parseStorageTables(tables)));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "sandboxes_storage_sync",
    "Push local changes, then pull remote changes",
    {
      tables: z.string().optional().describe("Comma-separated table names"),
    },
    async ({ tables }) => {
      try {
        return syncResult(await syncStorageChanges(parseStorageTables(tables)));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "sandboxes_feedback",
    "Save feedback for sandboxes",
    {
      message: z.string(),
      email: z.string().optional(),
      category: z.enum(["bug", "feature", "general"]).optional(),
    },
    async ({ message, email, category }) => {
      try {
        const db = getDatabase();
        db.run(
          "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
          [message, email || null, category || "general", getPackageVersion()]
        );
        return ok({ saved: true });
      } catch (error) {
        return err(error);
      }
    }
  );
}
