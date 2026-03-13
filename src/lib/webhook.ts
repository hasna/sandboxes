import { createHmac } from "node:crypto";
import { listWebhooks } from "../db/webhooks.js";


export interface WebhookPayload {
  event: string;
  sandbox_id?: string;
  session_id?: string;
  data: unknown;
  timestamp: string;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function dispatchWebhook(
  event: string,
  data: {
    sandbox_id?: string;
    session_id?: string;
    [key: string]: unknown;
  }
): Promise<void> {
  const webhooks = listWebhooks().filter((w) => {
    if (!w.active) return false;
    if (w.events.length === 0) return true;
    return w.events.includes(event) || w.events.includes("*");
  });

  if (webhooks.length === 0) return;

  const payload: WebhookPayload = {
    event,
    sandbox_id: data.sandbox_id,
    session_id: data.session_id,
    data,
    timestamp: new Date().toISOString(),
  };

  const body = JSON.stringify(payload);

  const deliveries = webhooks.map(async (webhook) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Webhook-Event": event,
    };

    if (webhook.secret) {
      headers["X-Webhook-Signature"] = `sha256=${sign(body, webhook.secret)}`;
    }

    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        console.error(
          `Webhook delivery failed to ${webhook.url}: ${res.status}`
        );
      }
    } catch (err) {
      console.error(
        `Webhook delivery error to ${webhook.url}: ${(err as Error).message}`
      );
    }
  });

  await Promise.allSettled(deliveries);
}

export const WEBHOOK_EVENTS = [
  "sandbox.created",
  "sandbox.started",
  "sandbox.stopped",
  "sandbox.deleted",
  "session.started",
  "session.completed",
  "session.output",
] as const;
