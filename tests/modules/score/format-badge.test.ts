import { describe, expect, it } from "vitest";
import { formatBadge } from "../../../src/modules/score/format-badge.js";
import { runScore } from "../../../src/modules/score/run.js";
import { loadFixtureSnapshot } from "./_helpers.js";

const META = { version: "0.2.0-test", asOf: "2026-05-19T12:00:00.000Z" };

describe("formatBadge", () => {
  it("emits Shields.io endpoint-compatible JSON", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const badge = JSON.parse(formatBadge(runScore(snap, META)));
    expect(badge.schemaVersion).toBe(1);
    expect(badge.label).toBe("sipcode");
    expect(typeof badge.message).toBe("string");
    expect(badge.message).toMatch(/^\d+ · /);
    expect(typeof badge.color).toBe("string");
    expect(badge.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("includes namedLogo and labelColor for brand consistency", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const badge = JSON.parse(formatBadge(runScore(snap, META)));
    expect(badge.namedLogo).toBe("github");
    expect(badge.labelColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("encodes the tier in the message string", async () => {
    const snap = await loadFixtureSnapshot("poor");
    const badge = JSON.parse(formatBadge(runScore(snap, META)));
    expect(badge.message).toMatch(/(platinum|gold|silver|bronze|needs-work)/);
  });

  it("is byte-identical run-over-run", async () => {
    const snap = await loadFixtureSnapshot("average");
    const a = formatBadge(runScore(snap, META));
    const b = formatBadge(runScore(snap, META));
    expect(a).toBe(b);
  });
});
