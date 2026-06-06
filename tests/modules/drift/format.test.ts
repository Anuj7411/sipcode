import { describe, it, expect } from "vitest";
import { renderDriftTerminal } from "../../../src/modules/drift/format-terminal.js";
import { renderDriftJson } from "../../../src/modules/drift/format-json.js";
import type { DriftReport } from "../../../src/modules/drift/types.js";

const regressed: DriftReport = {
  schemaVersion: "sipcode-drift/1",
  hasRegression: true,
  summary: "drift detected — 1 signal regressed.",
  causes: [
    {
      metric: "Tokens per turn",
      direction: "up",
      changeDisplay: "up 40%",
      baselineDisplay: "100",
      latestDisplay: "140",
      meaning: "Each step is sending more context than usual.",
      fix: "Start a fresh chat to reset the context.",
    },
  ],
  baseline: {
    count: 6,
    medianTokensPerTurn: 100,
    medianCacheHitRate: 0.9,
    medianDuplicateReadTokens: 0,
  },
  note: "n",
};

const stable: DriftReport = {
  schemaVersion: "sipcode-drift/1",
  hasRegression: false,
  summary: "no drift — context health stable.",
  causes: [],
  note: "n",
};

describe("renderDriftTerminal", () => {
  it("shows the ⚠ alarm with metric, norm→now, meaning and fix", () => {
    const out = renderDriftTerminal(regressed);
    expect(out).toContain("⚠");
    expect(out).toContain("Tokens per turn");
    expect(out).toContain("your norm: 100");
    expect(out).toContain("this session: 140");
    expect(out).toContain("→ Fix:");
    expect(out).toContain("context rot");
  });
  it("shows a calm one-liner when stable", () => {
    const out = renderDriftTerminal(stable);
    expect(out).toContain("stable");
    expect(out).not.toContain("⚠");
  });
});

describe("renderDriftJson", () => {
  it("emits parseable JSON with structured causes", () => {
    const obj = JSON.parse(renderDriftJson(regressed));
    expect(obj.schemaVersion).toBe("sipcode-drift/1");
    expect(obj.causes).toHaveLength(1);
    expect(obj.causes[0].metric).toBe("Tokens per turn");
    expect(obj.causes[0].fix).toContain("fresh chat");
  });
});
