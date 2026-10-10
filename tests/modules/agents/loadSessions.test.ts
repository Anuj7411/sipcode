import { describe, expect, it } from "vitest";
import { InMemoryFs, type FileSystem } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { loadSessions, type LoadedSession } from "../../../src/modules/agents/loadSessions.js";
import { dedupeAcrossSessions } from "../../../src/modules/transcript/dedupe.js";

const analyze = (s: LoadedSession) => s.parsed;

const req = (id: string, ts: string) =>
  JSON.stringify({
    type: "assistant",
    requestId: `req_${id}`,
    timestamp: ts,
    sessionId: "s",
    message: {
      id: `msg_${id}`,
      model: "claude-opus-5",
      role: "assistant",
      content: [{ type: "text", text: "." }],
      usage: {
        input_tokens: 1,
        output_tokens: 10,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 0,
      },
    },
  });

function deps() {
  const fs = new InMemoryFs();
  // b.jsonl is a resumed session: it repeats request 1 (original timestamp) and adds request 2.
  fs.writeFile(
    "/home/u/.claude/projects/C--p/a.jsonl",
    req("1", "2026-09-01T10:00:00Z"),
    Date.parse("2026-09-01T10:01:00Z"),
  );
  fs.writeFile(
    "/home/u/.claude/projects/C--p/b.jsonl",
    [req("1", "2026-09-01T10:00:00Z"), req("2", "2026-09-02T10:00:00Z")].join("\n"),
    Date.parse("2026-09-02T10:01:00Z"),
  );
  fs.writeFile(
    "/home/u/.claude/projects/C--q/c.jsonl",
    req("3", "2026-09-03T10:00:00Z"),
    Date.parse("2026-09-03T10:01:00Z"),
  );
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u" }),
    clock: new FakeClock(new Date("2026-10-01T00:00:00Z")),
  };
}

describe("loadSessions", () => {
  it("counts a request repeated in a resumed file once", async () => {
    const r = await loadSessions({ analyze, agent: claudeCodeAgent, deps: deps(), cwd: "/" });
    if (!r.ok) throw new Error("load failed");
    const turns = r.value.sessions.reduce((n, s) => n + s.value.assistantTurns.length, 0);
    expect(turns).toBe(3);
    expect(r.value.droppedDuplicateRequests).toBe(1);
    expect(r.value.discovered).toBe(3);
  });

  it("applies --here through the agent", async () => {
    const r = await loadSessions({
      analyze,
      agent: claudeCodeAgent,
      deps: deps(),
      cwd: "C:\\q",
      here: true,
    });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.sessions.map((s) => s.meta.sessionId)).toEqual(["c"]);
  });

  it("dedupes across ALL discovered sessions (no time pre-filter), so windows stay consistent", async () => {
    const r = await loadSessions({ analyze, agent: claudeCodeAgent, deps: deps(), cwd: "/" });
    if (!r.ok) throw new Error("load failed");
    const b = r.value.sessions.find((s) => s.meta.sessionId === "b")!;
    expect(b.value.assistantTurns.map((t) => t.requestKey)).toEqual(["msg_2|req_2"]);
    expect(b.value.startedAt).toBe("2026-09-02T10:00:00Z");
  });

  it("counts unreadable files instead of silently dropping them", async () => {
    const d = deps();
    const base: FileSystem = d.fs;
    const failingFs: FileSystem = {
      exists: (p) => base.exists(p),
      readHead: (p, n) => base.readHead(p, n),
      readDir: (p) => base.readDir(p),
      stat: (p) => base.stat(p),
      readFile: async (p) => {
        if (p.endsWith("c.jsonl")) throw new Error("EACCES");
        return base.readFile(p);
      },
    };
    const r = await loadSessions({
      analyze,
      agent: claudeCodeAgent,
      deps: { ...d, fs: failingFs },
      cwd: "/",
    });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.unreadable).toBe(1);
    expect(r.value.sessions).toHaveLength(2);
  });

  it("windowSinceMs: out-of-window files are scanned for dedupe only, not returned", async () => {
    const r = await loadSessions({
      analyze,
      agent: claudeCodeAgent,
      deps: deps(),
      cwd: "/",
      // between a.jsonl (09-01) and b.jsonl (09-02) mtimes
      windowSinceMs: Date.parse("2026-09-01T20:00:00Z"),
    });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.scannedOnly).toBe(1);
    expect(r.value.discovered).toBe(3);
    expect(r.value.sessions.map((s) => s.meta.sessionId).sort()).toEqual(["b", "c"]);
    const b = r.value.sessions.find((s) => s.meta.sessionId === "b")!;
    expect(b.value.assistantTurns.map((t) => t.requestKey)).toEqual(["msg_2|req_2"]);
    expect(b.value.startedAt).toBe("2026-09-02T10:00:00Z");
  });

  it("windowSinceMs: scanned stubs keep tie-break order (start, end, turn count)", async () => {
    const mk = (id: string, ts: string) => req(id, ts);
    const files: Array<[string, string[], string]> = [
      // old.jsonl has 3 turns; new.jsonl is a copy of the first two ending at the
      // same time, so new has FEWER turns and must claim r1/r2 in either mode.
      ["/home/u/.claude/projects/C--p/old.jsonl", [mk("1", "2026-09-01T10:00:00Z"), mk("2", "2026-09-01T10:05:00Z"), mk("9", "2026-09-01T10:05:00Z")], "2026-09-01T10:06:00Z"],
      ["/home/u/.claude/projects/C--p/new.jsonl", [mk("1", "2026-09-01T10:00:00Z"), mk("2", "2026-09-01T10:05:00Z")], "2026-09-05T10:06:00Z"],
    ];
    const build = () => {
      const fs = new InMemoryFs();
      for (const [p, lines, m] of files) fs.writeFile(p, lines.join("\n"), Date.parse(m));
      return {
        fs,
        env: new FakeProcessEnv({ homeDir: "/home/u" }),
        clock: new FakeClock(new Date("2026-10-01T00:00:00Z")),
      };
    };
    const full = await loadSessions({ analyze, agent: claudeCodeAgent, deps: build(), cwd: "/" });
    const win = await loadSessions({
      analyze,
      agent: claudeCodeAgent,
      deps: build(),
      cwd: "/",
      windowSinceMs: Date.parse("2026-09-03T00:00:00Z"),
    });
    if (!full.ok || !win.ok) throw new Error("load failed");
    expect(win.value.scannedOnly).toBe(1);
    const fullNew = full.value.sessions.find((s) => s.meta.sessionId === "new")!;
    const winNew = win.value.sessions.find((s) => s.meta.sessionId === "new")!;
    expect(winNew.value.assistantTurns.map((t) => t.requestKey)).toEqual(
      fullNew.value.assistantTurns.map((t) => t.requestKey),
    );
    expect(winNew.value.assistantTurns).toHaveLength(2);
    expect(winNew.value.startedAt).toBe(fullNew.value.startedAt);
    expect(winNew.value.endedAt).toBe(fullNew.value.endedAt);
  });

  it("windowSinceMs: unreadable out-of-window file is counted, not scanned", async () => {
    const d = deps();
    const base: FileSystem = d.fs;
    const failingFs: FileSystem = {
      exists: (p) => base.exists(p),
      readHead: (p, n) => base.readHead(p, n),
      readDir: (p) => base.readDir(p),
      stat: (p) => base.stat(p),
      readFile: async (p) => {
        if (p.endsWith("a.jsonl")) throw new Error("EACCES");
        return base.readFile(p);
      },
    };
    const r = await loadSessions({
      analyze,
      agent: claudeCodeAgent,
      deps: { ...d, fs: failingFs },
      cwd: "/",
      windowSinceMs: Date.parse("2026-09-01T20:00:00Z"),
    });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.unreadable).toBe(1);
    expect(r.value.scannedOnly).toBe(0);
  });

  it("without scanRequestKeys the window option is ignored (full parse)", async () => {
    const { scanRequestKeys: _unused, ...rest } = claudeCodeAgent;
    void _unused;
    const r = await loadSessions({
      analyze,
      agent: rest as typeof claudeCodeAgent,
      deps: deps(),
      cwd: "/",
      windowSinceMs: Date.parse("2026-09-01T20:00:00Z"),
    });
    if (!r.ok) throw new Error("load failed");
    expect(r.value.scannedOnly).toBe(0);
    expect(r.value.sessions).toHaveLength(3);
  });

  it("windowSinceMs: reads only the out-of-window files that can hold a copy (same project, written after the window's sessions started)", async () => {
    const fs = new InMemoryFs();
    const P = "/home/u/.claude/projects";
    // In the window: n.jsonl (project p), a resume of o1's request 1.
    fs.writeFile(`${P}/C--p/n.jsonl`, [req("1", "2026-09-20T10:00:00Z"), req("5", "2026-09-25T10:00:00Z")].join("\n"), Date.parse("2026-09-25T10:01:00Z"));
    // Out of the window: o1 (same project, written after n started) can hold a copy;
    // o2 (same project, last written months before n started) and q1 (another project) cannot.
    fs.writeFile(`${P}/C--p/o1.jsonl`, req("1", "2026-09-20T10:00:00Z"), Date.parse("2026-09-20T10:01:00Z"));
    fs.writeFile(`${P}/C--p/o2.jsonl`, req("7", "2026-06-01T10:00:00Z"), Date.parse("2026-06-01T10:01:00Z"));
    fs.writeFile(`${P}/C--q/q1.jsonl`, req("8", "2026-09-21T10:00:00Z"), Date.parse("2026-09-21T10:01:00Z"));
    const reads: string[] = [];
    const spyFs = Object.create(fs, {
      readFile: { value: async (f: string) => (reads.push(f.replace(/^.*[\\/]|\.jsonl$/g, "")), fs.readFile(f)) },
    }) as InMemoryFs;
    const d = { fs: spyFs, env: new FakeProcessEnv({ homeDir: "/home/u" }), clock: new FakeClock(new Date("2026-10-01T00:00:00Z")) };
    const r = await loadSessions({ analyze, agent: claudeCodeAgent, deps: d, cwd: "/", windowSinceMs: Date.parse("2026-09-24T00:00:00Z") });
    if (!r.ok) throw new Error("load failed");
    // o1 is scanned before n is analyzed, so n is read once.
    expect(reads.sort()).toEqual(["n", "o1"]);
    expect(r.value.scannedOnly).toBe(1);
    expect(r.value.sessions.map((s) => s.meta.sessionId)).toEqual(["n"]);
    expect(r.value.sessions[0]!.value.assistantTurns.map((t) => t.requestKey)).toEqual(["msg_5|req_5"]);
  });

  it("returns exactly what deduping every parsed session in memory gives (random resumed chains)", async () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let round = 0; round < 60; round++) {
      const fs = new InMemoryFs();
      const files: string[] = [];
      let nextReq = 1;
      const count = 2 + Math.floor(rand() * 6);
      const texts: string[][] = [];
      for (let f = 0; f < count; f++) {
        const lines: string[] = [];
        // Resume an earlier file: copy some of its lines (original timestamps).
        if (texts.length && rand() < 0.6) {
          const src = texts[Math.floor(rand() * texts.length)]!;
          lines.push(...src.slice(0, 1 + Math.floor(rand() * src.length)));
        }
        const own = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < own; k++) {
          const day = 1 + Math.floor(rand() * 28);
          lines.push(req(String(nextReq++), `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`));
        }
        texts.push(lines);
        const proj = rand() < 0.8 ? "C--p" : "C--q";
        const file = `/home/u/.claude/projects/${proj}/f${f}.jsonl`;
        fs.writeFile(file, lines.join("\n"), Date.parse("2026-09-29T00:00:00Z") + f * 1000);
        files.push(file);
      }
      const d = { fs, env: new FakeProcessEnv({ homeDir: "/home/u" }), clock: new FakeClock(new Date("2026-10-01T00:00:00Z")) };
      const r = await loadSessions({ analyze, agent: claudeCodeAgent, deps: d, cwd: "/" });
      if (!r.ok) throw new Error("load failed");
      // Reference: parse every discovered file (newest first, as discovery orders them), dedupe in memory.
      const order = r.value.sessions.map((s) => s.meta.filePath);
      const parsed = await Promise.all(
        order.map(async (f) => {
          const p = claudeCodeAgent.parseTranscript(await fs.readFile(f));
          if (!p.ok) throw new Error("parse failed");
          return p.value;
        }),
      );
      const ref = dedupeAcrossSessions(parsed);
      expect(r.value.sessions.map((s) => s.value), `round ${round}`).toEqual(ref.sessions);
      expect(r.value.droppedDuplicateRequests, `round ${round}`).toBe(ref.droppedRequests);
    }
  });
});
