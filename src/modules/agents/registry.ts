/**
 * Agent registry — single source of truth mapping AgentId → Agent.
 */
import { claudeCodeAgent } from "./claude-code/adapter.js";
import { codexAgent } from "./codex/adapter.js";
import { cursorAgent } from "./cursor/adapter.js";
import type { Agent, AgentId } from "./types.js";

export const REGISTRY: Readonly<Record<AgentId, Agent>> = {
  "claude-code": claudeCodeAgent,
  cursor: cursorAgent,
  codex: codexAgent,
};

export function getAgentById(id: AgentId): Agent {
  return REGISTRY[id];
}

export function listAgents(): readonly Agent[] {
  return Object.values(REGISTRY);
}
