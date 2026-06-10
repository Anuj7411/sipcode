import { describe, it, expect } from "vitest";
import {
  buildClaudeArgs,
  parseClaudeJson,
  runOneLive,
  aggregate,
  renderLiveTable,
  defaultResultsPath,
  type LiveIO,
  type LiveResultRow,
} from "../../../src/modules/benchmark/liveRunner.js";

function inMemoryIO(over: Partial<LiveIO> & { runIdSeed?: number } = {}): LiveIO & {
  spawned: { bin: string; args: string[]; cwd: string; prompt: string }[];
  written: { path: string; row: LiveResultRow }[];
} {
  const spawned: { bin: string; args: string[]; cwd: string; prompt: string }[] = [];
  const written: { path: string; row: LiveResultRow }[] = [];
  let counter = over.runIdSeed ?? 1;
  return {
    spawned,
    written,
    async appendResult(p, row) {
      written.push({ path: p, row });
    },
    async readResults() {
      return [];
    },
    async spawnClaude(opts) {
      spawned.push({ bin: opts.bin, args: opts.args, cwd: opts.cwd, prompt: opts.prompt });
      return {
        stdout: JSON.stringify({
          type: "result",
          model: "claude-sonnet-4-6",
          total_cost_usd: 0.05,
          usage: {
            input_tokens: 4000,
            output_tokens: 600,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 1500,
          },
        }),
        stderr: "",
        exitCode: 0,
        durationMs: 12345,
      };
    },
    newRunId() {
      return `run-fixture-${counter++}`;
    },
    now() {
      return new Date("2026-06-09T00:00:00.000Z");
    },
    ...over,
  };
}

describe("buildClaudeArgs", () => {
  it("builds the base argv (no condition flag — isolation is external via withSipcodeStripped)", () => {
    const a = buildClaudeArgs({ repoDir: "/r" });
    expect(a).toContain("--print");
    expect(a).toContain("--output-format");
    expect(a).toContain("json");
    expect(a).toContain("--add-dir");
    expect(a).toContain("/r");
    expect(a).toContain("--no-session-persistence");
  });

  it("never uses --bare (would force ANTHROPIC_API_KEY, breaking Max-plan OAuth)", () => {
    expect(buildClaudeArgs({ repoDir: "/r" })).not.toContain("--bare");
  });

  it("never uses --setting-sources (would skip ALL user settings, not just Sipcode)", () => {
    expect(buildClaudeArgs({ repoDir: "/r" })).not.toContain("--setting-sources");
  });

  it("appends --model when provided", () => {
    const a = buildClaudeArgs({ repoDir: "/r", model: "claude-opus-4" });
    expect(a).toContain("--model");
    expect(a).toContain("claude-opus-4");
  });

  it("applies a default max-budget-usd cap", () => {
    const a = buildClaudeArgs({ repoDir: "/r", maxBudgetUsd: 0.5 });
    expect(a).toContain("--max-budget-usd");
    expect(a).toContain("0.5");
  });
});

describe("parseClaudeJson", () => {
  it("extracts usage + cost from a usage block", () => {
    const stdout = JSON.stringify({
      model: "claude-sonnet-4-6",
      total_cost_usd: 0.02,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 300,
      },
    });
    const u = parseClaudeJson(stdout);
    expect(u.model).toBe("claude-sonnet-4-6");
    expect(u.inputTokens).toBe(1000);
    expect(u.outputTokens).toBe(500);
    expect(u.cacheTokens).toBe(400);
    expect(u.totalTokens).toBe(1900);
    expect(u.costUsd).toBe(0.02);
  });

  it("falls back to aggregate keys when usage block is missing", () => {
    const stdout = JSON.stringify({
      model: "x",
      total_input_tokens: 100,
      total_output_tokens: 50,
    });
    const u = parseClaudeJson(stdout);
    expect(u.inputTokens).toBe(100);
    expect(u.outputTokens).toBe(50);
    expect(u.totalTokens).toBe(150);
  });

  it("returns zeros + 'unknown' model on malformed JSON", () => {
    const u = parseClaudeJson("not json");
    expect(u.totalTokens).toBe(0);
    expect(u.model).toBe("unknown");
  });

  it("picks the LAST parseable JSON object on stdout (handles streaming preamble)", () => {
    const stdout = `{"type":"init"}\n{"type":"progress"}\n{"type":"result","model":"final","usage":{"input_tokens":999}}`;
    const u = parseClaudeJson(stdout);
    expect(u.model).toBe("final");
    expect(u.inputTokens).toBe(999);
  });
});

describe("runOneLive", () => {
  it("spawns claude with the right args, persists a result row, and returns it", async () => {
    const io = inMemoryIO();
    const row = await runOneLive(
      {
        taskId: "BT001",
        prompt: "rename oldFn to newFn",
        repoDir: "/r",
        condition: "on",
      },
      "/results.jsonl",
      io,
    );
    expect(io.spawned.length).toBe(1);
    expect(io.spawned[0]!.args).toContain("--add-dir");
    expect(io.spawned[0]!.prompt).toBe("rename oldFn to newFn");
    expect(row.taskId).toBe("BT001");
    expect(row.condition).toBe("on");
    expect(row.inputTokens).toBe(4000);
    expect(row.outputTokens).toBe(600);
    expect(row.cacheTokens).toBe(1700);
    expect(row.totalTokens).toBe(6300);
    expect(row.costUsd).toBe(0.05);
    expect(row.durationMs).toBe(12345);
    expect(io.written.length).toBe(1);
    expect(io.written[0]!.row.runId).toBe(row.runId);
  });

  it("records stderr tail on non-zero exit", async () => {
    const io: LiveIO = {
      ...inMemoryIO(),
      async spawnClaude() {
        return {
          stdout: "",
          stderr: "boom: API rate limit\n",
          exitCode: 7,
          durationMs: 100,
        };
      },
    };
    const row = await runOneLive(
      { taskId: "BT001", prompt: "x", repoDir: "/r", condition: "off" },
      "/r.jsonl",
      io,
    );
    expect(row.exitCode).toBe(7);
    expect(row.stderrTail).toContain("rate limit");
    expect(row.totalTokens).toBe(0);
  });
});

describe("aggregate", () => {
  const row = (over: Partial<LiveResultRow>): LiveResultRow => ({
    runId: "r",
    taskId: "BT001",
    condition: "off",
    model: "m",
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalTokens: 100,
    costUsd: 0.01,
    durationMs: 1000,
    completedAt: "2026-06-09T00:00:00.000Z",
    exitCode: 0,
    ...over,
  });

  it("medians per condition and computes sipcode savings %", () => {
    const rows = [
      row({ condition: "off", totalTokens: 1000 }),
      row({ condition: "off", totalTokens: 1200 }),
      row({ condition: "on", totalTokens: 600 }),
    ];
    const a = aggregate(rows);
    expect(a.length).toBe(1);
    expect(a[0]!.off?.medianTotalTokens).toBe(1100); // median of 1000, 1200
    expect(a[0]!.on?.medianTotalTokens).toBe(600);
    expect(a[0]!.sipcodeSavedPct).toBe(45); // (1100-600)/1100 = 45%
  });

  it("excludes runs with no measured tokens (the actual failure signal — exitCode is too noisy because tangential SessionEnd hooks can make claude exit 1 after work completed)", () => {
    const rows = [
      row({ condition: "off", totalTokens: 1000 }),
      row({ condition: "off", totalTokens: 0, exitCode: 1 }), // spawn died before any work
      row({ condition: "on", totalTokens: 500 }),
    ];
    const a = aggregate(rows);
    expect(a[0]!.off?.runs).toBe(1);
  });

  it("INCLUDES rows with exitCode != 0 when totalTokens > 0 (the SessionEnd hook misfire pattern observed 2026-06-09)", () => {
    const rows = [
      row({ condition: "off", totalTokens: 5000, exitCode: 1 }), // post-task hook failure, but work done
      row({ condition: "on", totalTokens: 3000, exitCode: 1 }),
    ];
    const a = aggregate(rows);
    expect(a[0]!.off?.runs).toBe(1);
    expect(a[0]!.on?.runs).toBe(1);
    expect(a[0]!.off?.medianTotalTokens).toBe(5000);
    expect(a[0]!.sipcodeSavedPct).toBe(40); // (5000-3000)/5000
  });

  it("returns 0% saving when one condition is missing", () => {
    const a = aggregate([row({ condition: "off", totalTokens: 100 })]);
    expect(a[0]!.sipcodeSavedPct).toBe(0);
    expect(a[0]!.on).toBeUndefined();
  });

  it("sorts results by taskId ascending", () => {
    const rows = [row({ taskId: "BT003" }), row({ taskId: "BT001" }), row({ taskId: "BT002" })];
    const a = aggregate(rows);
    expect(a.map((x) => x.taskId)).toEqual(["BT001", "BT002", "BT003"]);
  });
});

describe("renderLiveTable", () => {
  it("renders headers + per-task rows + aggregate footer when both conditions present", () => {
    const a = aggregate([
      {
        runId: "r1",
        taskId: "BT001",
        condition: "off",
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 10000,
        costUsd: 0.1,
        durationMs: 1,
        completedAt: "x",
        exitCode: 0,
      },
      {
        runId: "r2",
        taskId: "BT001",
        condition: "on",
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 6000,
        costUsd: 0.06,
        durationMs: 1,
        completedAt: "x",
        exitCode: 0,
      },
    ]);
    const txt = renderLiveTable(a);
    expect(txt).toContain("BT001");
    expect(txt).toContain("10,000");
    expect(txt).toContain("6,000");
    expect(txt).toContain("40%"); // 4000/10000
    expect(txt).toContain("measured savings");
  });

  it("renders an em-dash placeholder for missing conditions", () => {
    const a = aggregate([
      {
        runId: "r",
        taskId: "BT001",
        condition: "off",
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
        cacheTokens: 0,
        totalTokens: 5000,
        costUsd: 0.05,
        durationMs: 1,
        completedAt: "x",
        exitCode: 0,
      },
    ]);
    const txt = renderLiveTable(a);
    expect(txt).toContain("—"); // missing on/rtk slots
  });
});

describe("defaultResultsPath", () => {
  it("composes a stable path under ~/.sipcode/benchmark-live/", () => {
    const p = defaultResultsPath("/home/u");
    expect(p).toContain(".sipcode");
    expect(p).toContain("benchmark-live");
    expect(p.endsWith("results.jsonl")).toBe(true);
  });
});
