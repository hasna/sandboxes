import { endSession } from "../db/sessions.js";
import { updateSandbox } from "../db/sandboxes.js";

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function finalizeSessionExit(sessionId: string, exitCode: number): void {
  endSession(sessionId, exitCode, exitCode === 0 ? "completed" : "failed");
}

export function finalizeSessionFailure(sessionId: string, _error?: unknown, exitCode = 1): void {
  // Agent note: close failed sessions explicitly so async/provider errors do not linger as running.
  endSession(sessionId, exitCode, "failed");
}

export function finalizeSandboxProvisionFailure(sandboxId: string, error?: unknown): string {
  // Agent note: failed provider creates should leave a visible error state instead of "creating".
  updateSandbox(sandboxId, { status: "error" });
  return getErrorMessage(error);
}
