import { describe, it, expect } from "vitest";
import {
  hookAstRead,
  recordSignal,
  MIN_LINES_TO_TRIM,
  CONTEXT_LINES,
  type AstIO,
} from "../../../src/modules/proxy/hookAstRead.js";
import type { PreToolUseInput } from "../../../src/modules/proxy/types.js";
import { sessionSignalsPath, type Signal } from "../../../src/modules/proxy/signal-cache.js";

const SESSION = "sess-abc";
const HOME = "/h";

function makeIO(opts: {
  files?: Record<string, string>;
  signals?: Signal[];
  now?: Date;
}): AstIO & {
  written: { path: string; content: string }[];
} {
  const files = new Map<string, string>(Object.entries(opts.files ?? {}));
  const signalsPath = sessionSignalsPath(HOME, SESSION);
  if (opts.signals && opts.signals.length > 0) {
    files.set(
      signalsPath,
      opts.signals.map((s) => JSON.stringify(s)).join("\n") + "\n",
    );
  }
  const written: { path: string; content: string }[] = [];
  return {
    written,
    async read(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    async append(p, content) {
      written.push({ path: p, content });
      files.set(p, (files.get(p) ?? "") + content);
    },
    async readFile(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    now() {
      return opts.now ?? new Date("2026-06-12T00:00:00.000Z");
    },
  };
}

function input(over: Partial<PreToolUseInput> = {}): PreToolUseInput {
  return {
    session_id: SESSION,
    transcript_path: "/t",
    cwd: "/cwd",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: "/proj/auth.ts" },
    ...over,
  };
}

// Build a 220-line TS file containing a function named `authCheck` near top
// and a function named `unrelated` further down. Lines > MIN_LINES_TO_TRIM.
function buildLargeFile(): string {
  const lines: string[] = [];
  lines.push(`// auth.ts (220 lines synthetic)`);
  lines.push(`import { Db } from "./db.js";`);
  lines.push(``);
  lines.push(`export function authCheck(userId: string): boolean {`);
  lines.push(`  return userId.length > 0;`);
  lines.push(`}`);
  for (let i = 0; i < 200; i++) lines.push(`// padding line ${i}`);
  lines.push(`export function unrelated() { return 42; }`);
  lines.push(``);
  return lines.join("\n");
}

describe("hookAstRead — passthrough cases (bias to safety)", () => {
  it("returns EMPTY for non-Read tools", async () => {
    const r = await hookAstRead(
      input({ tool_name: "Bash", tool_input: { command: "ls" } }),
      HOME,
      makeIO({}),
    );
    expect(r.hookOutput).toBeNull();
  });

  it("returns EMPTY for non-TS/JS files", async () => {
    const r = await hookAstRead(
      input({ tool_input: { file_path: "/proj/notes.md" } }),
      HOME,
      makeIO({}),
    );
    expect(r.hookOutput).toBeNull();
  });

  it("returns EMPTY when the model already specified offset", async () => {
    const io = makeIO({
      files: { "/proj/auth.ts": buildLargeFile() },
      signals: [{ tool: "Grep", kind: "grep-pattern", pattern: "authCheck", capturedAtMs: 1 }],
    });
    const r = await hookAstRead(
      input({ tool_input: { file_path: "/proj/auth.ts", offset: 0 } }),
      HOME,
      io,
    );
    expect(r.hookOutput).toBeNull();
  });

  it("returns EMPTY when file is too small to bother", async () => {
    const small = Array.from({ length: MIN_LINES_TO_TRIM - 1 })
      .map((_, i) => `// line ${i}`)
      .join("\n");
    const io = makeIO({
      files: { "/proj/auth.ts": small },
      signals: [{ tool: "Grep", kind: "grep-pattern", pattern: "authCheck", capturedAtMs: 1 }],
    });
    const r = await hookAstRead(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
  });

  it("returns EMPTY when there are no signals to trim by", async () => {
    const io = makeIO({ files: { "/proj/auth.ts": buildLargeFile() } });
    const r = await hookAstRead(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
  });

  it("returns EMPTY when no signal matches any symbol", async () => {
    const io = makeIO({
      files: { "/proj/auth.ts": buildLargeFile() },
      signals: [{ tool: "Grep", kind: "grep-pattern", pattern: "totallyDifferent", capturedAtMs: 1 }],
    });
    const r = await hookAstRead(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
  });

  it("returns EMPTY when file cannot be read", async () => {
    const io = makeIO({
      signals: [{ tool: "Grep", kind: "grep-pattern", pattern: "authCheck", capturedAtMs: 1 }],
    });
    const r = await hookAstRead(input(), HOME, io);
    expect(r.hookOutput).toBeNull();
  });
});

describe("hookAstRead — Python", () => {
  function buildLargePyFile(): string {
    const lines: string[] = [];
    lines.push(`# auth.py (220 lines synthetic)`);
    lines.push(`from db import Db`);
    lines.push(``);
    lines.push(`def auth_check(user_id):`);
    lines.push(`    return len(user_id) > 0`);
    for (let i = 0; i < 215; i++) lines.push(`# padding line ${i}`);
    return lines.join("\n");
  }

  it("trims a large .py file when a grep matches a python symbol", async () => {
    const io = makeIO({
      files: { "/proj/auth.py": buildLargePyFile() },
      signals: [{ tool: "Bash", kind: "grep-pattern", pattern: "auth_check", capturedAtMs: 1 }],
    });
    const r = await hookAstRead(
      input({ tool_input: { file_path: "/proj/auth.py" } }),
      HOME,
      io,
    );
    expect(r.hookOutput).not.toBeNull();
    const updated = r.hookOutput!.hookSpecificOutput.updatedInput!;
    expect(typeof updated.offset).toBe("number");
    expect(updated.limit as number).toBeLessThan(50);
    expect(r.statsEntry?.rewriterName).toBe("ast-read");
  });

  it("passes through non-Python and non-JS/TS files (e.g. .md)", async () => {
    const io = makeIO({
      files: { "/proj/notes.md": "x".repeat(10000) },
      signals: [{ tool: "Grep", kind: "grep-pattern", pattern: "x", capturedAtMs: 1 }],
    });
    const r = await hookAstRead(
      input({ tool_input: { file_path: "/proj/notes.md" } }),
      HOME,
      io,
    );
    expect(r.hookOutput).toBeNull();
  });
});

describe("hookAstRead — trim cases", () => {
  it("trims to the picked symbol's line range + context buffer", async () => {
    const io = makeIO({
      files: { "/proj/auth.ts": buildLargeFile() },
      signals: [{ tool: "Grep", kind: "grep-pattern", pattern: "authCheck", capturedAtMs: 1 }],
    });
    const r = await hookAstRead(input(), HOME, io);
    expect(r.hookOutput).not.toBeNull();
    const out = r.hookOutput!.hookSpecificOutput;
    expect(out.permissionDecision).toBe("allow");
    expect(out.updatedInput).toBeDefined();
    const updated = out.updatedInput!;
    expect(typeof updated.offset).toBe("number");
    expect(typeof updated.limit).toBe("number");
    // authCheck starts at line 4; with CONTEXT_LINES buffer the offset
    // should be (4 - CONTEXT_LINES - 1) = 0 (clamped to 0) and limit small.
    expect(updated.offset as number).toBeLessThanOrEqual(4);
    expect(updated.limit as number).toBeLessThan(50); // way smaller than 220-line file
    expect(r.statsEntry?.rewriterName).toBe("ast-read");
    expect((r.statsEntry?.savedTokensEstimate ?? 0)).toBeGreaterThan(0);
    expect(r.statsEntry?.integrityScore).toBe(0.7);
  });

  it("falls back to passthrough if the slice would cover ~the whole file anyway", async () => {
    // Construct: 220-line file with the matched symbol spanning lines 5 to 195.
    const lines: string[] = [];
    lines.push(`// header line 1`);
    lines.push(`// header line 2`);
    lines.push(`// header line 3`);
    lines.push(`// header line 4`);
    lines.push(`export class HugeClass {`);
    for (let i = 0; i < 190; i++) lines.push(`  method${i}() { return ${i}; }`);
    lines.push(`}`);
    for (let i = 0; i < 20; i++) lines.push(`// trailing ${i}`);
    const io = makeIO({
      files: { "/proj/auth.ts": lines.join("\n") },
      signals: [{ tool: "Grep", kind: "grep-pattern", pattern: "HugeClass", capturedAtMs: 1 }],
    });
    const r = await hookAstRead(input(), HOME, io);
    // Slice would cover ≥80% of file → orchestrator bails.
    expect(r.hookOutput).toBeNull();
  });
});

describe("recordSignal", () => {
  it("appends a Grep pattern signal", async () => {
    const io = makeIO({});
    await recordSignal(
      input({ tool_name: "Grep", tool_input: { pattern: "authCheck" } }),
      HOME,
      io,
    );
    expect(io.written.length).toBe(1);
    const written = JSON.parse(io.written[0]!.content.trim());
    expect(written.pattern).toBe("authCheck");
    expect(written.tool).toBe("Grep");
  });

  it("no-op for Read tool calls (Read isn't a search signal)", async () => {
    const io = makeIO({});
    await recordSignal(
      input({ tool_name: "Read", tool_input: { file_path: "/x.ts" } }),
      HOME,
      io,
    );
    expect(io.written.length).toBe(0);
  });

  it("no-op when session_id is missing", async () => {
    const io = makeIO({});
    await recordSignal(
      input({ tool_name: "Grep", session_id: "", tool_input: { pattern: "x" } }),
      HOME,
      io,
    );
    expect(io.written.length).toBe(0);
  });

  it("swallows append failures (must never break Claude Code)", async () => {
    const io: AstIO = {
      ...makeIO({}),
      async append() {
        throw new Error("disk full");
      },
    };
    // Should not throw.
    await recordSignal(
      input({ tool_name: "Grep", tool_input: { pattern: "x" } }),
      HOME,
      io,
    );
  });
});

void CONTEXT_LINES;
