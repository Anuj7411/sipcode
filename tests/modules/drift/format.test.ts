import { describe, it, expect } from "vitest";
import { renderDriftTerminal } from "../../../src/modules/drift/format-terminal.js";
import { renderDriftJson } from "../../../src/modules/drift/format-json.js";
import type { DriftReport } from "../../../src/modules/drift/types.js";

const regressed: DriftReport = {
  schemaVersion: "sipcode-drift/1",
  hasRegression: true,
  summary: "drift detected — 1 signal regressed.",
  causes: [{ label: "cost/turn up", detail: "tokens/turn rose ~40% (100 → 140)" }],
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
  it("shows the ⚠ alarm and causes on regression", () => {
    const out = renderDriftTerminal(regressed);
    expect(out).toContain("⚠");
    expect(out).toContain("tokens/turn rose");
  });
  it("shows a calm one-liner when stable", () => {
    const out = renderDriftTerminal(stable);
    expect(out).toContain("stable");
    expect(out).not.toContain("⚠");
  });
});

describe("renderDriftJson", () => {
  it("emits parseable JSON with schemaVersion", () => {
    const obj = JSON.parse(renderDriftJson(regressed));
    expect(obj.schemaVersion).toBe("sipcode-drift/1");
    expect(obj.causes).toHaveLength(1);
  });
});
