/**
 * Which other files can hold a copy of a target session's requests, so
 * single-session commands and windowed loads read only those.
 * Codex: copies only move along fork / subagent links (named in line 1), so
 * a file outside the target's family holds none; a family with a link to a
 * log Sipcode cannot see is "open" and stays a candidate for every target.
 */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { FakeProcessEnv } from "../../../src/lib/process.js";
import { codexAgent } from "../../../src/modules/agents/codex/adapter.js";
import {
  discoverAgentSessions,
  dropCopiedRequests,
  type LoadedSession,
} from "../../../src/modules/agents/loadSessions.js";
import { CODEX_SESSIONS } from "../../integration/codex-fixtures.js";

const line = (o: unknown): string => JSON.stringify(o);

/** A rollout: session_meta (with any lineage fields), then one record per response id. */
function rollout(id: string, metaExtra: object, responses: string[], at = "2026-05-10T10:00:00Z", withMeta = true): string {
  const lines = withMeta
    ? [line({ timestamp: at, type: "session_meta", payload: { id, session_id: id, cwd: "C:\\p", ...metaExtra } })]
    : [];
  responses.forEach((r, i) => {
    lines.push(line({ timestamp: at, type: "turn_context", payload: { turn_id: `${id}-u${i}`, model: "gpt-5.5" } }));
    lines.push(
      line({
        timestamp: at,
        type: "token_usage_record",
        payload: { turn_id: `${id}-u${i}`, response_id: r, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } },
      }),
    );
  });
  return lines.join("\n");
}

function deps(fs: InMemoryFs) {
  return { fs, env: new FakeProcessEnv({ homeDir: "/home/u" }), clock: new FakeClock(new Date("2026-06-01T00:00:00Z")) };
}

async function setup(files: Record<string, string>) {
  const fs = new InMemoryFs();
  let m = Date.parse("2026-05-10T11:00:00Z");
  for (const [name, text] of Object.entries(files)) fs.writeFile(`${CODEX_SESSIONS}/2026/05/10/rollout-${name}.jsonl`, text, (m += 60_000));
  const reads: string[] = [];
  const spyFs = Object.create(fs, {
    readFile: { value: async (p: string) => (reads.push(p.replace(/^.*rollout-|\.jsonl$/g, "")), fs.readFile(p)) },
  }) as InMemoryFs;
  const d = deps(spyFs);
  const disc = await discoverAgentSessions(codexAgent, d);
  if (!disc.ok) throw new Error("discovery failed");
  return { d, all: disc.value.sessions, reads };
}

async function target(d: ReturnType<typeof deps>, all: LoadedSession["meta"][], name: string): Promise<LoadedSession> {
  const meta = all.find((m) => m.filePath.endsWith(`rollout-${name}.jsonl`))!;
  const p = codexAgent.parseTranscript(await d.fs.readFile(meta.filePath));
  if (!p.ok) throw new Error("parse failed");
  return { meta, parsed: p.value };
}

describe("dropCopiedRequests: Codex candidates", () => {
  it("reads only the target's family (fork parent, subagent), not unrelated rollouts", async () => {
    const { d, all, reads } = await setup({
      p1: rollout("p1", {}, ["r1", "r2"], "2026-05-10T09:00:00Z"),
      f1: rollout("f1", { forked_from_id: "p1" }, ["r1", "r2", "r3"], "2026-05-10T09:30:00Z"),
      s1: rollout("s1", { session_id: "p1", parent_thread_id: "f1", source: { subagent: { other: "x" } } }, ["r3", "r4"], "2026-05-10T09:40:00Z"),
      u1: rollout("u1", {}, ["x1"]),
      u2: rollout("u2", { forked_from_id: "u1" }, ["x1", "x2"]),
    });
    const t = await target(d, all, "f1");
    reads.length = 0;
    const r = await dropCopiedRequests({ agent: codexAgent, deps: d, targets: [t], all });
    expect(reads.sort()).toEqual(["p1", "s1"]);
    expect(r.candidatesRead).toBe(2);
    expect(r.sessions[0]!.assistantTurns.map((x) => x.requestKey)).toEqual(["r3"]);
  });

  it("a subagent found through thread_spawn's parent_thread_id is family too", async () => {
    const { d, all, reads } = await setup({
      p1: rollout("p1", {}, ["r1"], "2026-05-10T09:00:00Z"),
      s1: rollout("s1", { source: { subagent: { thread_spawn: { parent_thread_id: "p1" } } } }, ["r1", "r2"], "2026-05-10T09:30:00Z"),
      u1: rollout("u1", {}, ["x1"]),
    });
    const t = await target(d, all, "s1");
    reads.length = 0;
    const r = await dropCopiedRequests({ agent: codexAgent, deps: d, targets: [t], all });
    expect(reads).toEqual(["p1"]);
    expect(r.sessions[0]!.assistantTurns.map((x) => x.requestKey)).toEqual(["r2"]);
  });

  it("an open family (a link to a log that is not there) is a candidate for every target", async () => {
    const { d, all, reads } = await setup({
      a1: rollout("a1", { forked_from_id: "gone" }, ["r1", "r5"], "2026-05-10T09:00:00Z"),
      t1: rollout("t1", { forked_from_id: "gone" }, ["r1", "r6"], "2026-05-10T09:30:00Z"),
      u1: rollout("u1", {}, ["x1"]),
    });
    // t1 and a1 both name "gone": one open family. u1 is closed and unrelated.
    const t = await target(d, all, "t1");
    reads.length = 0;
    await dropCopiedRequests({ agent: codexAgent, deps: d, targets: [t], all });
    expect(reads.sort()).toEqual(["a1", "u1"]);
    // A closed target reads only its own family plus open families.
    const u = await target(d, all, "u1");
    reads.length = 0;
    await dropCopiedRequests({ agent: codexAgent, deps: d, targets: [u], all });
    expect(reads.sort()).toEqual(["a1", "t1"]);
  });

  it("a rollout without session_meta is open (candidate for every target)", async () => {
    const { d, all, reads } = await setup({
      p1: rollout("p1", {}, ["r1"], "2026-05-10T09:00:00Z"),
      n1: rollout("n1", {}, ["r1", "r9"], "2026-05-10T09:30:00Z", false),
      u1: rollout("u1", {}, ["x1"]),
    });
    const t = await target(d, all, "p1");
    reads.length = 0;
    await dropCopiedRequests({ agent: codexAgent, deps: d, targets: [t], all });
    expect(reads).toEqual(["n1"]);
  });
});
