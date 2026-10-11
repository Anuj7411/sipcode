import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanCodexRateLimits } from "../../../../src/modules/agents/codex/rateLimits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.resolve(__dirname, "../../../fixtures/codex", name), "utf-8");

const tokenCount = (timestamp: string | undefined, rate_limits: unknown): string =>
  JSON.stringify({ timestamp, type: "event_msg", payload: { type: "token_count", info: null, rate_limits } });

const win = (used_percent: number, window_minutes: number, resetsIso: string) => ({
  used_percent,
  window_minutes,
  resets_at: Date.parse(resetsIso) / 1000,
});

const T = "2026-10-07T10:00:00.000Z";

describe("scanCodexRateLimits", () => {
  it("returns one reading per non-null window, times in ms", () => {
    const content = [
      JSON.stringify({ timestamp: "2026-10-07T09:00:00.000Z", type: "session_meta", payload: { id: "s1" } }),
      tokenCount(T, {
        limit_id: "codex",
        limit_name: null,
        plan_type: "plus",
        primary: win(12, 300, "2026-10-07T14:00:00.000Z"),
        secondary: win(40, 10080, "2026-10-14T08:30:00.000Z"),
        credits: null,
      }),
    ].join("\n");
    const r = scanCodexRateLimits(content, { sessionId: "s1" });
    expect(r.malformed).toBe(0);
    expect(r.readings).toEqual([
      {
        at: Date.parse(T),
        sessionId: "s1",
        limitId: "codex",
        planType: "plus",
        windowMinutes: 300,
        slot: "primary",
        usedPercent: 12,
        resetsAt: Date.parse("2026-10-07T14:00:00.000Z"),
      },
      {
        at: Date.parse(T),
        sessionId: "s1",
        limitId: "codex",
        planType: "plus",
        windowMinutes: 10080,
        slot: "secondary",
        usedPercent: 40,
        resetsAt: Date.parse("2026-10-14T08:30:00.000Z"),
      },
    ]);
  });

  it("skips a null rate_limits and null windows without counting them", () => {
    const content = [
      tokenCount(T, null),
      tokenCount(T, { limit_id: "codex", primary: null, secondary: null }),
      tokenCount(T, { limit_id: "premium", plan_type: "go", primary: win(3, 43200, "2026-11-01T00:00:00.000Z"), secondary: null }),
    ].join("\n");
    const r = scanCodexRateLimits(content, { sessionId: "s1" });
    expect(r.malformed).toBe(0);
    expect(r.readings.map((x) => [x.limitId, x.windowMinutes, x.usedPercent])).toEqual([["premium", 43200, 3]]);
  });

  it("counts a cut-off line, a reading without a timestamp and windows with bad numbers", () => {
    const content = [
      '{"timestamp":"2026-10-07T10:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary"',
      tokenCount(undefined, { primary: win(5, 300, "2026-10-07T14:00:00.000Z") }),
      tokenCount(T, {
        primary: { used_percent: "5", window_minutes: 300, resets_at: 1 },
        secondary: { used_percent: 5, window_minutes: 0, resets_at: 1 },
      }),
    ].join("\n");
    const r = scanCodexRateLimits(content, { sessionId: "s1" });
    expect(r.readings).toEqual([]);
    expect(r.malformed).toBe(4);
  });

  it("ignores the words rate_limits outside token_count events", () => {
    const content = JSON.stringify({
      timestamp: T,
      type: "response_item",
      payload: { type: "message", content: [{ type: "output_text", text: 'the "rate_limits" field' }] },
    });
    expect(scanCodexRateLimits(content, { sessionId: "s1" })).toEqual({ readings: [], malformed: 0 });
  });

  it("accepts a resets_at already in milliseconds without multiplying it again", () => {
    const resetsMs = Date.parse("2026-10-14T08:30:00.000Z");
    const r = scanCodexRateLimits(
      tokenCount(T, { primary: { used_percent: 7, window_minutes: 10080, resets_at: resetsMs } }),
      { sessionId: "s1" },
    );
    expect(r.malformed).toBe(0);
    expect(r.readings[0]?.resetsAt).toBe(resetsMs);
  });

  it("defaults the limit id to codex and leaves a missing plan type undefined", () => {
    const r = scanCodexRateLimits(tokenCount(T, { primary: win(7, 10080, "2026-10-14T08:30:00.000Z") }), {
      sessionId: "s1",
    });
    expect(r.readings[0]?.limitId).toBe("codex");
    expect(r.readings[0]?.planType).toBeUndefined();
  });

  it("reads the anonymised fixtures (one rate_limits line in compacted.jsonl has a null window)", () => {
    const compacted = scanCodexRateLimits(fixture("compacted.jsonl"), { sessionId: "c" });
    expect(compacted.readings).toHaveLength(167);
    expect(compacted.malformed).toBe(0);
    expect(new Set(compacted.readings.map((r) => r.windowMinutes))).toEqual(new Set([10080]));
    const records = scanCodexRateLimits(fixture("token-usage-record.jsonl"), { sessionId: "r" });
    expect(records.readings).toHaveLength(47);
    expect(records.readings.at(-1)?.usedPercent).toBe(50);
  });
});
