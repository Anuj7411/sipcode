/**
 * why / receipt / drift across Claude Code and Codex: the newest session
 * across both tools, labelled with its tool, plus a hint for the other;
 * --agent restricts; JSON stays one tool with a stderr note.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { FakeClipboard } from "../../src/lib/clipboard.js";
import { runWhy } from "../../src/commands/why.js";
import { runReceipt } from "../../src/commands/receipt.js";
import { runDriftCommand } from "../../src/commands/drift.js";
import type { StoreIO } from "../../src/modules/drift/store.js";
import { addCodexRollout, CODEX_SESSIONS, codexRollout, solTurn } from "./codex-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../fixtures/transcripts");
const loadFixture = (n: string) => readFileSync(path.join(fixtures, n), "utf-8");

const NOW = new Date("2026-05-15T00:00:00Z");
const CLAUDE_HINT = "Claude Code also has a recent session (readheav): run with --agent claude-code.";

function claudeFs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile(
    "/home/u/.claude/projects/test-proj/readheavy1.jsonl",
    loadFixture("read-heavy.jsonl"),
    new Date("2026-05-02T09:00:30Z").getTime(),
  );
  fs.writeFile(
    "/home/u/.claude/projects/test-proj/minimal01.jsonl",
    loadFixture("minimal-2turn.jsonl"),
    new Date("2026-05-01T10:00:45Z").getTime(),
  );
  return fs;
}

/** Claude Code logs plus a NEWER Codex rollout. */
function bothFs(): InMemoryFs {
  const fs = claudeFs();
  addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z")]);
  return fs;
}

function codexOnlyFs(): InMemoryFs {
  const fs = new InMemoryFs();
  addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z")]);
  return fs;
}

/** A Codex subagent thread, newer than everything else. */
function addSubagent(fs: InMemoryFs): void {
  const lines = codexRollout("sub1", "C:\\p", [solTurn("2026-05-12T10:00:00Z")]).split("\n");
  const meta = JSON.parse(lines[0]!) as { payload: Record<string, unknown> };
  meta.payload.parent_thread_id = "cx1";
  lines[0] = JSON.stringify(meta);
  fs.writeFile(`${CODEX_SESSIONS}/2026/05/12/rollout-sub1.jsonl`, lines.join("\n"), Date.parse("2026-05-12T10:01:00Z"));
}

function memStoreIO(): StoreIO {
  const files = new Map<string, string>();
  return {
    async read(p) {
      return files.get(p) ?? null;
    },
    async write(p, c) {
      files.set(p, c);
    },
    async append(p, c) {
      files.set(p, (files.get(p) ?? "") + c);
    },
  };
}

type Run = (
  opts: { agent?: string; json?: boolean; session?: string; here?: boolean; cwd?: string },
  fs: InMemoryFs,
) => Promise<{ exitCode: number; out: string; err: string; outLines: string[] }>;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
      clock: new FakeClock(NOW),
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
    },
    done: (exitCode: number) => ({ exitCode, out: out.join("\n"), err: err.join("\n"), outLines: out }),
  };
}

const why: Run = async (opts, fs) => {
  const c = capture();
  const r = await runWhy({ cwd: "/w", ...opts }, { fs, ...c.io });
  return c.done(r.exitCode);
};

const receipt: Run = async (opts, fs) => {
  const c = capture();
  const r = await runReceipt(
    { cwd: "/w", htmlOnly: true, noShare: true, ...opts },
    { fs, ...c.io, clipboard: new FakeClipboard(), writeFile: async () => {} },
  );
  return c.done(r.exitCode);
};

const drift: Run = async (opts, fs) => {
  const c = capture();
  const r = await runDriftCommand(
    { cwd: "/w", ...opts },
    { fs, ...c.io, now: NOW, homeDir: "/home/u", stateDir: "/state", storeIO: memStoreIO(), configPaths: [], configReader: async () => null },
  );
  return c.done(r.exitCode);
};

const commands: Array<[string, Run]> = [
  ["why", why],
  ["receipt", receipt],
  ["drift", drift],
];

for (const [name, run] of commands) {
  describe(`${name} across Claude Code and Codex`, () => {
    it("reports on the newer Codex session, names the tool, and hints Claude Code", async () => {
      const r = await run({}, bothFs());
      expect(r.exitCode).toBe(0);
      expect(r.outLines[0]).toBe("── Codex ──");
      expect(r.outLines.at(-1)).toBe(CLAUDE_HINT);
      // Nothing else in the report talks about Claude.
      expect(r.outLines.slice(0, -1).join("\n")).not.toContain("Claude");
    });

    it("--agent claude-code is byte-identical to a Claude-only machine", async () => {
      const claudeOnly = await run({}, claudeFs());
      const flagged = await run({ agent: "claude-code" }, bothFs());
      expect(flagged).toEqual(claudeOnly);
      expect(claudeOnly.out).not.toContain("──");
    });

    it("works on a Codex-only machine (no ~/.claude): no headers, no hint, no Claude", async () => {
      const r = await run({}, codexOnlyFs());
      expect(r.exitCode).toBe(0);
      expect(r.out).not.toContain("──");
      expect(r.out).not.toContain("Claude");
      expect(r.err).not.toContain("[E003]");
    });

    it("never auto-picks a Codex subagent thread", async () => {
      const fs = bothFs();
      addSubagent(fs);
      const r = await run({ json: true, agent: "codex" }, fs);
      expect(r.exitCode).toBe(0);
      expect(r.out).not.toContain("sub1");
    });

    it("a --session prefix matching both tools lists the matches and exits 1", async () => {
      const fs = bothFs();
      fs.writeFile("/home/u/.claude/projects/test-proj/cx-claude.jsonl", loadFixture("minimal-2turn.jsonl"), 1_000);
      const r = await run({ session: "cx" }, fs);
      expect(r.exitCode).toBe(1);
      expect(r.err).toContain(`[E003] "cx" matches sessions in more than one tool:`);
      expect(r.err).toContain("  Codex: cx1");
      expect(r.err).toContain("  Claude Code: cx-claud");
      // The suggested command runs as written (receipt takes the id as an argument).
      expect(r.err).toContain(
        name === "receipt" ? "next: npx sipcode receipt cx1 --agent codex" : `next: npx sipcode ${name} --agent codex --session cx1`,
      );
      expect(r.out).toBe("");
    });

    it("a --session prefix in one tool picks that tool, with no hint", async () => {
      const r = await run({ session: "readheavy" }, bothFs());
      expect(r.exitCode).toBe(0);
      expect(r.outLines[0]).toBe("── Claude Code ──");
      expect(r.out).not.toContain("also has a recent session");
    });

    it("JSON: one tool (Claude Code, unchanged) plus a stderr note; --agent codex for Codex", async () => {
      const claudeOnly = await run({ json: true }, claudeFs());
      const both = await run({ json: true }, bothFs());
      expect(both.out).toBe(claudeOnly.out);
      expect(both.err).toMatch(/run with --agent codex for Codex/);
      expect(claudeOnly.err).not.toMatch(/--agent codex/);
      const codex = await run({ json: true, agent: "codex" }, bothFs());
      expect(codex.exitCode).toBe(0);
      expect(codex.out).not.toBe(claudeOnly.out);
      expect(() => JSON.parse(codex.out)).not.toThrow();
      expect(codex.err).toBe("");
    });

    it("JSON --session searches both tools: a Codex-only id is found, a Claude id is unchanged", async () => {
      const codex = await run({ json: true, session: "cx1" }, bothFs());
      expect(codex.exitCode).toBe(0);
      expect(codex.out).toBe((await run({ json: true, agent: "codex", session: "cx1" }, bothFs())).out);
      expect(codex.err).toBe("");
      const claude = await run({ json: true, session: "readheavy" }, bothFs());
      expect(claude.exitCode).toBe(0);
      expect(claude.out).toBe((await run({ json: true, session: "readheavy" }, claudeFs())).out);
      // The id named one session: no "Codex logs found too" note.
      expect(claude.err).not.toMatch(/--agent codex/);
    });

    it("JSON --session matching both tools: the terminal's error, exit 1", async () => {
      const fs = bothFs();
      fs.writeFile("/home/u/.claude/projects/test-proj/cx-claude.jsonl", loadFixture("minimal-2turn.jsonl"), 1_000);
      const json = await run({ json: true, session: "cx" }, fs);
      const terminal = await run({ session: "cx" }, fs);
      expect(json.exitCode).toBe(1);
      expect(json.out).toBe("");
      expect(json.err).toBe(terminal.err);
      expect(json.err).toContain(`[E003] "cx" matches sessions in more than one tool:`);
    });

    it("with --here, the other-tool hint keeps --here", async () => {
      const fs = new InMemoryFs();
      fs.writeFile("/home/u/.claude/projects/-w/readheavy1.jsonl", loadFixture("read-heavy.jsonl"), Date.parse("2026-05-02T09:00:30Z"));
      addCodexRollout(fs, "cx1", [solTurn("2026-05-10T10:00:00Z")], "/w");
      const r = await run({ here: true }, fs);
      expect(r.exitCode).toBe(0);
      expect(r.outLines.at(-1)).toBe(
        "Claude Code also has a recent session (readheav): run with --agent claude-code --here.",
      );
    });

    it("--agent codex with no Codex logs never shows Claude Code data", async () => {
      const r = await run({ agent: "codex" }, claudeFs());
      expect(r.out).not.toContain("readheav");
      expect(r.out + r.err).toContain("Codex");
    });
  });
}

describe("Codex wording in the reports", () => {
  it("why: Codex gets its own next step and capture hint, priced from the OpenAI table", async () => {
    const r = await why({ agent: "codex" }, codexOnlyFs());
    expect(r.out).toContain("gpt-6.1-sol");
    expect(r.out).not.toContain("rules --install");
    expect(r.out).not.toContain("npx sipcode init");
    expect(r.out).toContain("run `npx sipcode stats --agent codex` to track your Codex spend");
    const openaiAsOf = (
      JSON.parse(readFileSync(path.resolve(__dirname, "../../src/lib/pricing/openai-2026-10-08.json"), "utf-8")) as { as_of: string }
    ).as_of;
    expect(r.out).toContain(`prices from ${openaiAsOf}`);
    const json = JSON.parse((await why({ agent: "codex", json: true }, codexOnlyFs())).out);
    expect(json.metaPricing.asOf).toBe(openaiAsOf);
    expect(json.header.model).toBe("gpt-6.1-sol");
  });

  it("why: skipped Codex lines show up as a warning", async () => {
    const fs = codexOnlyFs();
    const file = (await fs.readDir(`${CODEX_SESSIONS}/2026/05/10`))[0]!.name;
    const p = `${CODEX_SESSIONS}/2026/05/10/${file}`;
    fs.writeFile(p, (await fs.readFile(p)) + "\n{not json", Date.parse("2026-05-10T10:01:00Z"));
    const json = JSON.parse((await why({ json: true }, fs)).out);
    expect(json.warnings).toEqual([{ code: "E003", message: "1 line(s) could not be read (skipped)." }]);
  });

  it("receipt: a Codex receipt is never the post-install 'sipped' variant", async () => {
    const r = await receipt({ json: true }, codexOnlyFs());
    const j = JSON.parse(r.out);
    expect(j.variant).toBe("pre-install");
    expect(j.hero.sublabel).toBe("wasted");
  });

  it("receipt: two Codex sessions get their own folder (time-ordered ids share 4 characters)", async () => {
    const fs = new InMemoryFs();
    addCodexRollout(fs, "0199a1b2-0000-7000-8000-000000000001", [solTurn("2026-05-10T10:00:00Z")]);
    addCodexRollout(fs, "0199c3d4-0000-7000-8000-000000000002", [solTurn("2026-05-11T10:00:00Z")]);
    const a = JSON.parse((await receipt({ json: true, session: "0199a1b2" }, fs)).out);
    const b = JSON.parse((await receipt({ json: true, session: "0199c3d4" }, fs)).out);
    expect([a.sessionIdShort, b.sessionIdShort]).toEqual(["0199a1b2-0000-7000", "0199c3d4-0000-7000"]);
    expect(a.htmlPath).not.toBe(b.htmlPath);
  });

  it("Codex sessions started in the same minute get their own id and receipt folder", async () => {
    // UUIDv7: the first 8 hex digits are shared for ~65 s (a parent and its subagent).
    const parent = "0199a1b2-c3d4-7a11-8000-000000000001";
    const child = "0199a1b2-c3f0-7b22-8000-000000000002";
    const fs = new InMemoryFs();
    addCodexRollout(fs, parent, [solTurn("2026-05-10T10:00:00Z")]);
    addCodexRollout(fs, child, [solTurn("2026-05-10T10:00:30Z")]);
    const a = JSON.parse((await receipt({ json: true, session: parent }, fs)).out);
    const b = JSON.parse((await receipt({ json: true, session: child }, fs)).out);
    expect([a.sessionIdShort, b.sessionIdShort]).toEqual(["0199a1b2-c3d4-7a11", "0199a1b2-c3f0-7b22"]);
    expect(a.htmlPath).not.toBe(b.htmlPath);
    // The id shown is a --session prefix that finds exactly that session.
    const w = JSON.parse((await why({ json: true, session: a.sessionIdShort }, fs)).out);
    expect(w.header.sessionIdShort).toBe("0199a1b2-c3d4-7a11");
    const list = await why({ list: true } as never, fs);
    expect(list.out).toContain("0199a1b2-c3d4-7a11  ");
    expect(list.out).toContain("0199a1b2-c3f0-7b22  ");
  });

  it("drift: Codex wording when there is not enough history", async () => {
    const r = await drift({}, codexOnlyFs());
    expect(r.out).toContain("Keep using Codex and re-run.");
  });

  it("drift --here with nothing in this folder says so (sessions exist elsewhere)", async () => {
    const r = await drift({ here: true, agent: "claude-code" }, claudeFs());
    expect(r.exitCode).toBe(0);
    expect(r.out).toBe(
      "Sipcode drift: no Claude Code sessions found for this folder. Drop --here to look across all folders.",
    );
    const j = JSON.parse((await drift({ here: true, json: true }, bothFs())).out);
    expect(j.status).toBe("no-data");
    expect(j.summary).toBe("no Claude Code sessions found for this folder. Drop --here to look across all folders.");
  });

  it("drift --here on a machine with no sessions at all keeps the first-run message", async () => {
    const r = await drift({ here: true, agent: "codex" }, new InMemoryFs());
    expect(r.out).toBe("Sipcode drift: no sessions found yet. Use Codex, then re-run.");
  });

  it("drift on Codex skips Claude Code's MCP attribution and never writes configs.jsonl", async () => {
    const io = memStoreIO();
    const configReads: string[] = [];
    const c = capture();
    const r = await runDriftCommand(
      { cwd: "/w", agent: "codex", json: true },
      {
        fs: codexOnlyFs(),
        ...c.io,
        now: NOW,
        homeDir: "/home/u",
        stateDir: "/state",
        storeIO: io,
        configPaths: ["/home/u/.claude.json"],
        configReader: async (p) => (configReads.push(p), '{"mcpServers":{"a":{}}}'),
      },
    );
    expect(r.exitCode).toBe(0);
    expect(configReads).toEqual([]);
    expect(await io.read("/state/configs.jsonl")).toBeNull();
    // The session cache is still written.
    expect(await io.read(path.join("/state", "sessions-v3.jsonl"))).not.toBeNull();
    // Same setup on Claude Code does read the config and snapshot it.
    const io2 = memStoreIO();
    const c2 = capture();
    await runDriftCommand(
      { cwd: "/w", agent: "claude-code", json: true },
      {
        fs: claudeFs(),
        ...c2.io,
        now: NOW,
        homeDir: "/home/u",
        stateDir: "/state",
        storeIO: io2,
        configPaths: ["/home/u/.claude.json"],
        configReader: async (p) => (configReads.push(p), '{"mcpServers":{"a":{}}}'),
      },
    );
    expect(configReads.length).toBeGreaterThan(0);
    expect(await io2.read(path.join("/state", "configs.jsonl"))).not.toBeNull();
  });

  it("why --list shows both tools under headers", async () => {
    const r = await why({ list: true } as never, bothFs());
    expect(r.exitCode).toBe(0);
    expect(r.outLines[0]).toBe("── Claude Code ──");
    expect(r.out).toContain("── Codex ──");
    expect(r.out).toContain("cx1");
  });
});
