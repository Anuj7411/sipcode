import { describe, expect, it } from "vitest";
import { formatTodayTerminal } from "../../../src/modules/today/format-terminal.js";
import { runToday } from "../../../src/modules/today/runToday.js";

const NOW = new Date("2026-10-09T10:00:00.000Z");
const LINE = "Codex weekly limit: 62% used, resets Wed 08:30. At this pace you run out Sat ~13:00.";

describe("formatTodayTerminal limitLine", () => {
  const empty = runToday({ sessions: [], now: NOW, agent: { name: "Codex", command: "codex" } });
  const one = runToday({
    sessions: [
      {
        sessionId: "s1",
        startedAt: "2026-10-09T09:00:00.000Z",
        totalTokens: 1000,
        outputTokens: 100,
        estCostUSD: 0.01,
        duplicateReadTokenCost: 0,
      },
    ],
    now: NOW,
  });

  it("without a line the output is unchanged", () => {
    expect(formatTodayTerminal(empty, { limitLine: undefined })).toBe(formatTodayTerminal(empty));
    expect(formatTodayTerminal(one, { limitLine: undefined })).toBe(formatTodayTerminal(one));
  });

  it("the line is printed last, in every status", () => {
    expect(formatTodayTerminal(empty, { limitLine: LINE })).toBe(`${formatTodayTerminal(empty)}\n${LINE}`);
    expect(formatTodayTerminal(one, { limitLine: LINE })).toBe(`${formatTodayTerminal(one)}\n${LINE}`);
  });
});
