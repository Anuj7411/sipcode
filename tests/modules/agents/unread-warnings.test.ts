/**
 * The warning about logs Sipcode could not read: one line per reason with the
 * exact count and the tool's name, and, for single-session commands, printed
 * before the first line the command writes (UnreadOutput).
 */
import { describe, expect, it } from "vitest";
import { issue } from "../../../src/lib/errors.js";
import { claudeCodeAgent } from "../../../src/modules/agents/claude-code/adapter.js";
import { discoveryNotes, unreadWarnings } from "../../../src/modules/agents/loadSessions.js";
import { UnreadOutput, type AgentSessions } from "../../../src/modules/agents/latest.js";
import type { Agent } from "../../../src/modules/agents/types.js";

const NONE = { unreadable: 0, unreadableFolders: 0, skippedCompressed: 0, issues: [] };
const codex = { ...claudeCodeAgent, id: "codex", displayName: "Codex" } as Agent;

describe("unreadWarnings", () => {
  it("nothing unread: no lines", () => {
    expect(unreadWarnings("Codex", NONE)).toEqual([]);
  });

  it("one line per reason, exact counts, the Node.js version for compressed logs", () => {
    const lines = unreadWarnings(
      "Claude Code",
      { unreadable: 2, unreadableFolders: 1, skippedCompressed: 3, issues: [issue("E003", "x")] },
      "v22.11.0",
    );
    expect(lines).toEqual([
      "warning: 3 Claude Code log file(s) could not be read (compressed .jsonl.zst logs need Node.js 22.15 or newer; you have v22.11.0). Numbers below leave them out.",
      "warning: 3 Claude Code log file(s) could not be read (unreadable or damaged). Numbers below leave them out.",
      "warning: 1 Claude Code log folder(s) could not be read (the folder could not be listed). Numbers below leave them out.",
    ]);
  });

  it("copy rules: no em or en dashes", () => {
    const all = unreadWarnings("Codex", { unreadable: 1, unreadableFolders: 1, skippedCompressed: 1, issues: [] }).join("\n");
    expect(all).not.toMatch(/[–—]/);
  });
});

describe("UnreadOutput (why / receipt / drift)", () => {
  const list = (agent: Agent, counts = NONE): AgentSessions => ({ agent, all: [], scoped: [], counts });

  function make(json: boolean) {
    const out: string[] = [];
    const err: string[] = [];
    const u = new UnreadOutput(json, (s) => out.push(s), (s) => err.push(s));
    return { u, out, err };
  }

  it("output before discovery passes through untouched", () => {
    const { u, out, err } = make(false);
    u.stderr("bad flag");
    u.stdout("x");
    expect(err).toEqual(["bad flag"]);
    expect(out).toEqual(["x"]);
  });

  it("nothing unread: output unchanged", () => {
    const { u, out, err } = make(false);
    u.watch([list(claudeCodeAgent), list(codex)]);
    u.stdout("report");
    expect(out).toEqual(["report"]);
    expect(err).toEqual([]);
  });

  it("terminal: the warnings, then a blank line, come before the first line on either stream, once", () => {
    const { u, out, err } = make(false);
    u.watch([list(claudeCodeAgent), list(codex, { ...NONE, unreadable: 1 })]);
    u.unreadable(codex);
    u.stderr("no sessions found");
    u.stdout("later");
    expect(out).toEqual([
      "warning: 2 Codex log file(s) could not be read (unreadable or damaged). Numbers below leave them out.",
      "",
      "later",
    ]);
    expect(err).toEqual(["no sessions found"]);
  });

  it("--json: the usual notes on stderr, named by tool when several were looked at; stdout untouched", () => {
    const one = make(true);
    one.u.watch([list(codex, { ...NONE, unreadable: 1 })]);
    one.u.stdout("{}");
    expect(one.out).toEqual(["{}"]);
    expect(one.err).toEqual(["note: 1 transcript file(s) could not be read or parsed; totals exclude them."]);

    const two = make(true);
    two.u.watch([list(claudeCodeAgent), list(codex, { ...NONE, unreadable: 1 })]);
    two.u.stdout("{}");
    expect(two.err).toEqual([`Codex: ${discoveryNotes({ ...NONE, unreadable: 1 })[0]}`]);
  });
});
