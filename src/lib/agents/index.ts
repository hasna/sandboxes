import { CodexDriver } from "./codex.js";
import { GeminiDriver } from "./gemini.js";
import { OpenCodeDriver } from "./opencode.js";
import { PiDriver } from "./pi.js";
import { TakumiDriver } from "./takumi.js";
import type { AgentDriver } from "./types.js";

export type { AgentDriver };

const DRIVERS: AgentDriver[] = [
  new CodexDriver(),
  new GeminiDriver(),
  new OpenCodeDriver(),
  new PiDriver(),
  new TakumiDriver(),
];

const DRIVER_MAP = new Map<string, AgentDriver>(
  DRIVERS.map((d) => [d.name, d])
);

export function getAgentDriver(name: string): AgentDriver | undefined {
  return DRIVER_MAP.get(name);
}

export function listAgentDrivers(): AgentDriver[] {
  return DRIVERS;
}
