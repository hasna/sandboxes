import { addEvent } from "../db/events.js";
import type { EventType } from "../types/index.js";

export type StreamListener = (type: EventType, data: string) => void;

const listeners = new Map<string, Set<StreamListener>>();

export function addStreamListener(
  sandboxId: string,
  listener: StreamListener
): () => void {
  if (!listeners.has(sandboxId)) {
    listeners.set(sandboxId, new Set());
  }
  listeners.get(sandboxId)!.add(listener);

  return () => {
    listeners.get(sandboxId)?.delete(listener);
    if (listeners.get(sandboxId)?.size === 0) {
      listeners.delete(sandboxId);
    }
  };
}

function notifyListeners(
  sandboxId: string,
  type: EventType,
  data: string
): void {
  const sandboxListeners = listeners.get(sandboxId);
  if (sandboxListeners) {
    for (const listener of sandboxListeners) {
      try {
        listener(type, data);
      } catch {
        // Don't let listener errors break the stream
      }
    }
  }
}

export function createStreamCollector(
  sandboxId: string,
  sessionId?: string
): {
  onStdout: (data: string) => void;
  onStderr: (data: string) => void;
  getOutput: () => { stdout: string; stderr: string };
} {
  let stdout = "";
  let stderr = "";

  return {
    onStdout: (data: string) => {
      stdout += data;
      addEvent({
        sandbox_id: sandboxId,
        session_id: sessionId,
        type: "stdout",
        data,
      });
      notifyListeners(sandboxId, "stdout", data);
    },
    onStderr: (data: string) => {
      stderr += data;
      addEvent({
        sandbox_id: sandboxId,
        session_id: sessionId,
        type: "stderr",
        data,
      });
      notifyListeners(sandboxId, "stderr", data);
    },
    getOutput: () => ({ stdout, stderr }),
  };
}

export function emitLifecycleEvent(
  sandboxId: string,
  message: string
): void {
  addEvent({
    sandbox_id: sandboxId,
    type: "lifecycle",
    data: message,
  });
  notifyListeners(sandboxId, "lifecycle", message);
}
