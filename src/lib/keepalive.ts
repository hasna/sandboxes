import { getSandbox, updateSandbox } from "../db/sandboxes.js";
import { getProvider } from "../providers/index.js";
import { emitLifecycleEvent } from "./stream.js";
import { now } from "../db/database.js";

const activeTimers = new Map<string, ReturnType<typeof setInterval>>();

export function startKeepAlive(
  sandboxId: string,
  intervalMs: number = 60_000
): void {
  // Don't create duplicate timers
  if (activeTimers.has(sandboxId)) return;

  const timer = setInterval(async () => {
    try {
      const sandbox = getSandbox(sandboxId);

      if (
        sandbox.status === "stopped" ||
        sandbox.status === "deleted" ||
        sandbox.status === "error"
      ) {
        stopKeepAlive(sandboxId);
        return;
      }

      if (!sandbox.provider_sandbox_id) return;

      const provider = await getProvider(sandbox.provider);
      await provider.keepAlive(sandbox.provider_sandbox_id, intervalMs * 2);

      updateSandbox(sandboxId, { keep_alive_until: now() });
    } catch (err) {
      emitLifecycleEvent(
        sandboxId,
        `Keep-alive failed: ${(err as Error).message}`
      );
      stopKeepAlive(sandboxId);
    }
  }, intervalMs);

  activeTimers.set(sandboxId, timer);
}

export function stopKeepAlive(sandboxId: string): void {
  const timer = activeTimers.get(sandboxId);
  if (timer) {
    clearInterval(timer);
    activeTimers.delete(sandboxId);
  }
}

export function isKeepAliveActive(sandboxId: string): boolean {
  return activeTimers.has(sandboxId);
}

export function stopAllKeepAlives(): void {
  for (const [id, timer] of activeTimers) {
    clearInterval(timer);
    activeTimers.delete(id);
  }
}
