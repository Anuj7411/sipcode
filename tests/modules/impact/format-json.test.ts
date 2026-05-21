import { describe, it, expect } from "vitest";
import { formatJson } from "../../../src/modules/impact/format-json.js";
import { runImpact } from "../../../src/modules/impact/runImpact.js";

describe("formatJson", () => {
  it("produces valid JSON parseable by JSON.parse", () => {
    const report = runImpact({
      sessions: [],
      installedAtIso: null,
      markerSource: "none",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    const json = formatJson(report);
    expect(() => JSON.parse(json)).not.toThrow();
    const round = JSON.parse(json);
    expect(round.schemaVersion).toBe("sipcode-impact/1");
    expect(round.status).toBe("no-install-marker");
  });

  it("uses 2-space indentation", () => {
    const report = runImpact({
      sessions: [],
      installedAtIso: null,
      markerSource: "none",
      nowIso: "2026-05-22T00:00:00.000Z",
    });
    const json = formatJson(report);
    expect(json).toContain('\n  "schemaVersion"');
  });
});
