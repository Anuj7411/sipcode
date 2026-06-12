import { describe, it, expect } from "vitest";
import {
  loadSignals,
  appendSignal,
  sessionSignalsPath,
  deriveSignalFromInput,
  MAX_SIGNALS,
  type Signal,
  type StoreIO,
} from "../../../src/modules/proxy/signal-cache.js";

function inMemoryIO(initial: Record<string, string> = {}): StoreIO & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    async read(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    async append(p, content) {
      files.set(p, (files.get(p) ?? "") + content);
    },
  };
}

const sample = (over: Partial<Signal> = {}): Signal => ({
  tool: "Grep",
  kind: "grep-pattern",
  pattern: "authCheck",
  capturedAtMs: 1_000_000,
  ...over,
});

describe("loadSignals", () => {
  it("returns [] when no file exists", async () => {
    const io = inMemoryIO();
    const result = await loadSignals("/x/missing.jsonl", io);
    expect(result.length).toBe(0);
  });

  it("parses JSONL signals and sorts newest-first", async () => {
    const io = inMemoryIO({
      "/c.jsonl":
        JSON.stringify(sample({ pattern: "old", capturedAtMs: 1 })) +
        "\n" +
        JSON.stringify(sample({ pattern: "new", capturedAtMs: 10 })) +
        "\n",
    });
    const signals = await loadSignals("/c.jsonl", io);
    expect(signals.map((s) => s.pattern)).toEqual(["new", "old"]);
  });

  it("skips malformed lines without throwing", async () => {
    const io = inMemoryIO({
      "/c.jsonl":
        "{not json}\n" +
        JSON.stringify(sample({ pattern: "good" })) +
        "\nanother bad line\n",
    });
    const signals = await loadSignals("/c.jsonl", io);
    expect(signals.length).toBe(1);
    expect(signals[0]!.pattern).toBe("good");
  });

  it("caps load at MAX_SIGNALS", async () => {
    const lines: string[] = [];
    for (let i = 0; i < MAX_SIGNALS + 50; i++) {
      lines.push(JSON.stringify(sample({ pattern: `p${i}`, capturedAtMs: i })));
    }
    const io = inMemoryIO({ "/c.jsonl": lines.join("\n") + "\n" });
    const signals = await loadSignals("/c.jsonl", io);
    expect(signals.length).toBe(MAX_SIGNALS);
    // Most recent should be present (highest capturedAtMs).
    expect(signals[0]!.pattern).toBe(`p${MAX_SIGNALS + 50 - 1}`);
  });
});

describe("appendSignal + round-trip", () => {
  it("appends a JSONL line, terminated by newline", async () => {
    const io = inMemoryIO();
    await appendSignal("/c.jsonl", sample({ pattern: "x" }), io);
    const raw = io.files.get("/c.jsonl")!;
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw.trim()).pattern).toBe("x");
  });

  it("round-trips through load", async () => {
    const io = inMemoryIO();
    await appendSignal("/c.jsonl", sample({ pattern: "alpha", capturedAtMs: 1 }), io);
    await appendSignal("/c.jsonl", sample({ pattern: "beta", capturedAtMs: 2 }), io);
    const signals = await loadSignals("/c.jsonl", io);
    expect(signals.map((s) => s.pattern)).toEqual(["beta", "alpha"]);
  });
});

describe("deriveSignalFromInput", () => {
  it("captures native Grep pattern", () => {
    const s = deriveSignalFromInput("Grep", { pattern: "authCheck" }, 42);
    expect(s).toEqual({
      tool: "Grep",
      kind: "grep-pattern",
      pattern: "authCheck",
      capturedAtMs: 42,
    });
  });

  it("captures native Glob pattern", () => {
    const s = deriveSignalFromInput("Glob", { pattern: "**/*.ts" }, 42);
    expect(s?.kind).toBe("glob-pattern");
    expect(s?.pattern).toBe("**/*.ts");
  });

  it("captures Bash grep pattern with flag", () => {
    const s = deriveSignalFromInput(
      "Bash",
      { command: "grep -r authCheck src/" },
      42,
    );
    expect(s?.tool).toBe("Bash");
    expect(s?.pattern).toBe("authCheck");
  });

  it("captures Bash rg (ripgrep) pattern", () => {
    const s = deriveSignalFromInput("Bash", { command: "rg --files-with-matches userId" }, 42);
    expect(s?.pattern).toBe("userId");
  });

  it("returns null on tools with no pattern", () => {
    expect(deriveSignalFromInput("Read", { file_path: "/a" }, 0)).toBeNull();
    expect(deriveSignalFromInput("Edit", { file_path: "/a" }, 0)).toBeNull();
  });

  it("returns null on Bash commands that don't look like search", () => {
    expect(deriveSignalFromInput("Bash", { command: "ls -la" }, 0)).toBeNull();
    expect(deriveSignalFromInput("Bash", { command: "git status" }, 0)).toBeNull();
  });

  it("returns null on missing/empty pattern", () => {
    expect(deriveSignalFromInput("Grep", {}, 0)).toBeNull();
    expect(deriveSignalFromInput("Grep", { pattern: "" }, 0)).toBeNull();
  });
});

describe("sessionSignalsPath", () => {
  it("composes ~/.sipcode/proxy-signals/<sid>.jsonl", () => {
    const p = sessionSignalsPath("/h", "sess-xyz");
    expect(p).toContain(".sipcode");
    expect(p).toContain("proxy-signals");
    expect(p.endsWith("sess-xyz.jsonl")).toBe(true);
  });
});
