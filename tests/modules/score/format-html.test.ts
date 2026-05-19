import { describe, expect, it } from "vitest";
import { formatHtml } from "../../../src/modules/score/format-html.js";
import { runScore } from "../../../src/modules/score/run.js";
import { loadFixtureSnapshot } from "./_helpers.js";

const META = { version: "0.2.0-test", asOf: "2026-05-19T12:00:00.000Z" };

describe("formatHtml", () => {
  it("emits a complete standalone html document", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const html = formatHtml(runScore(snap, META));
    expect(html.startsWith("<!doctype html>") || html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
  });

  it("includes the tier and project name", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const html = formatHtml(runScore(snap, META));
    expect(html).toContain("excellent");
    expect(html).toContain("platinum");
  });

  it("escapes html-special characters in the project name", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const evil = { ...runScore(snap, META) };
    (evil as { project: { name: string; filesScanned: number } }).project = {
      name: "<script>alert(1)</script>",
      filesScanned: 1,
    };
    const html = formatHtml(evil);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("stays under 30KB for a typical project", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const html = formatHtml(runScore(snap, META));
    const bytes = Buffer.byteLength(html, "utf8");
    expect(bytes).toBeLessThanOrEqual(30 * 1024);
  });

  it("is byte-identical when run twice", async () => {
    const snap = await loadFixtureSnapshot("average");
    const a = formatHtml(runScore(snap, META));
    const b = formatHtml(runScore(snap, META));
    expect(a).toBe(b);
  });
});
