import { describe, expect, it } from "vitest";
import { formatHtml } from "../../../src/modules/stats/format-html.js";
import { renderStats } from "../../../src/modules/stats/render.js";
import { parseSince } from "../../../src/modules/stats/window.js";
import type { AggregatedSession } from "../../../src/modules/stats/types.js";
import { loadPricingForDate } from "../../../src/lib/pricing/load.js";

const NOW = new Date("2026-05-19T12:00:00.000Z");

function session(over: Partial<AggregatedSession> = {}): AggregatedSession {
  return {
    sessionId: "abc12345xyz",
    sessionIdShort: "abc12345",
    projectHash: "C--Projects-Sipcode",
    projectName: "Sipcode",
    startedAt: "2026-05-18T00:00:00.000Z",
    endedAt: "2026-05-18T00:30:00.000Z",
    durationSec: 1800,
    durationHuman: "30m 00s",
    primaryModel: "claude-opus-4",
    inputTokens: 1234,
    outputTokens: 567,
    cacheReadTokens: 8901,
    cacheCreationTokens: 2345,
    totalTokens: 13047,
    outputRatioPct: 4.3,
    estCostUSD: 1.23,
    toolCallCount: 10,
    duplicateReadTokens: 100,
    idleContextTokens: 200,
    label: "",
    ...over,
  };
}

function makeReport(sessions = [session()]) {
  const w = parseSince("30d", NOW);
  if (!w.ok) throw new Error("setup");
  const pricing = loadPricingForDate(NOW);
  return renderStats({
    window: w.value,
    agent: "claude-code",
    sessions,
    topN: 5,
    groupBy: "none",
    pricing,
    pricingAgeDays: 18,
    warnings: [],
  });
}

describe("formatHtml", () => {
  it("emits a doctype + standalone html", () => {
    const html = formatHtml(makeReport());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>sipcode stats");
    expect(html).toContain("<style>");
    expect(html).toContain("</html>");
  });

  it("inlines an SVG sparkline", () => {
    const html = formatHtml(makeReport());
    expect(html).toContain("<svg ");
    expect(html).toContain("token spend per day");
  });

  it("is under 50KB on a normal-sized report", () => {
    const sessions: AggregatedSession[] = [];
    for (let i = 0; i < 47; i++) {
      sessions.push(
        session({
          sessionId: `id-${i}`,
          sessionIdShort: `id-${i.toString().padStart(4, "0")}`,
        }),
      );
    }
    const html = formatHtml(makeReport(sessions));
    expect(Buffer.byteLength(html, "utf-8")).toBeLessThan(50_000);
  });

  it("is byte-identical across two renders of the same input", () => {
    const r = makeReport();
    expect(formatHtml(r)).toBe(formatHtml(r));
  });

  it("escapes user data to prevent HTML injection", () => {
    const sessions = [
      session({
        projectName: "<script>alert(1)</script>",
        label: "<img onerror=alert(2)>",
      }),
    ];
    const html = formatHtml(makeReport(sessions));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });

  it("emits no SVG bars when there are zero days (defensive)", () => {
    const w = parseSince("30d", NOW);
    if (!w.ok) throw new Error("setup");
    const pricing = loadPricingForDate(NOW);
    const empty = renderStats({
      window: w.value,
      agent: "claude-code",
      sessions: [],
      topN: 5,
      groupBy: "none",
      pricing,
      pricingAgeDays: 18,
      warnings: [],
    });
    const html = formatHtml(empty);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("0 sessions");
  });
});
