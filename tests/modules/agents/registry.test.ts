import { describe, expect, it } from "vitest";
import { getAgentById, listAgents, REGISTRY } from "../../../src/modules/agents/registry.js";
import { ALL_AGENT_IDS } from "../../../src/modules/agents/types.js";

describe("agent registry", () => {
  it("exposes claude-code and cursor", () => {
    expect(getAgentById("claude-code").id).toBe("claude-code");
    expect(getAgentById("cursor").id).toBe("cursor");
  });

  it("listAgents returns all registered agents", () => {
    const ids = listAgents().map((a) => a.id).sort();
    expect(ids).toEqual([...ALL_AGENT_IDS].sort());
  });

  it("ALL_AGENT_IDS covers every key in REGISTRY", () => {
    expect(Object.keys(REGISTRY).sort()).toEqual([...ALL_AGENT_IDS].sort());
  });

  it("claude-code declares transcript parsing supported", () => {
    expect(getAgentById("claude-code").transcriptParsingSupported).toBe(true);
  });

  it("cursor declares transcript parsing unsupported (E009 stub)", () => {
    expect(getAgentById("cursor").transcriptParsingSupported).toBe(false);
  });

  it("each agent advertises at least one rules path candidate", () => {
    for (const a of listAgents()) {
      const paths = a.rulesPathCandidates("/proj");
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) expect(typeof p).toBe("string");
    }
  });
});
