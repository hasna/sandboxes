import { randomBytes } from "node:crypto";
import { getDatabase, uuid, now, resolvePartialId } from "./database";
import type { Webhook, WebhookRow, CreateWebhookInput } from "../types/index";
import { WebhookNotFoundError } from "../types/index";

// ── Row conversion ────────────────────────────────────────────────────

export function rowToWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events),
    secret: row.secret,
    active: row.active === 1,
    created_at: row.created_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────

export function createWebhook(input: CreateWebhookInput): Webhook {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();
  const events = JSON.stringify(input.events ?? []);
  const secret = input.secret ?? randomBytes(32).toString("hex");

  db.query(
    `INSERT INTO webhooks (id, url, events, secret, active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(id, input.url, events, secret, timestamp);

  return getWebhook(id);
}

export function getWebhook(id: string): Webhook {
  const db = getDatabase();

  const resolvedId = resolvePartialId("webhooks", id);
  if (!resolvedId) throw new WebhookNotFoundError(id);

  const row = db
    .query("SELECT * FROM webhooks WHERE id = ?")
    .get(resolvedId) as WebhookRow | null;

  if (!row) throw new WebhookNotFoundError(id);
  return rowToWebhook(row);
}

export function listWebhooks(): Webhook[] {
  const db = getDatabase();

  const rows = db
    .query("SELECT * FROM webhooks ORDER BY created_at DESC")
    .all() as WebhookRow[];

  return rows.map(rowToWebhook);
}

export function deleteWebhook(id: string): void {
  const db = getDatabase();

  const resolvedId = resolvePartialId("webhooks", id);
  if (!resolvedId) throw new WebhookNotFoundError(id);

  db.query("DELETE FROM webhooks WHERE id = ?").run(resolvedId);
}
