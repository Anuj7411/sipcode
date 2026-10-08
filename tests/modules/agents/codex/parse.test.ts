import { describe, expect, it } from "vitest";
import {
  execWrappedCommands,
  parseCodexMeta,
  parseCodexRollout,
  parseCodexRolloutWithStats,
  shellOutputFailed,
} from "../../../../src/modules/agents/codex/parse.js";
import { normalizeFilePath } from "../../../../src/lib/path-normalize.js";
import type { ParsedSession } from "../../../../src/modules/transcript/parse.js";

const L = (type: string, payload: object, ts = "2026-10-01T10:00:00.000Z") => JSON.stringify({ timestamp: ts, type, payload });
const meta = (extra: object = {}) => L("session_meta", { id: "t1", session_id: "t1", cwd: "C:\\p", cli_version: "0.160.0", originator: "codex_cli_rs", source: "cli", ...extra });
const ctx = (turnId: string, model: string, cwd = "C:\\p") => L("turn_context", { turn_id: turnId, model, effort: "medium", cwd });
const usage = (input: number, cached: number, write: number, output: number, reasoning = 0) =>
  ({ input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: write, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output });
const rec = (turnId: string, rid: string | undefined, u: object, thread?: object) =>
  L("token_usage_record", { thread_id: "t1", turn_id: turnId, session_id: "t1", ...(rid ? { response_id: rid } : {}), usage: u, ...(thread ? { thread_token_usage: thread } : {}) });
const tc = (total: object, last: object) => L("event_msg", { type: "token_count", info: { total_token_usage: total, last_token_usage: last, model_context_window: 258400 } });
const parse = (lines: string[]): ParsedSession => { const r = parseCodexRollout(lines.join("\n")); if (!r.ok) throw new Error("parse failed"); return r.value; };
const sum = (s: ParsedSession) => s.assistantTurns.reduce((n, t) => n + t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens + t.outputTokens, 0);
const fc = (name: string, args: object, id: string) => L("response_item", { type: "function_call", name, arguments: JSON.stringify(args), call_id: id });
const out = (id: string, text: string) => L("response_item", { type: "function_call_output", call_id: id, output: text });
const cout = (id: string, text: string) => L("response_item", { type: "custom_tool_call_output", call_id: id, output: text });
const names = (s: ParsedSession) => s.toolCalls.map((c) => [c.name, (c.input as { file_path?: string; command?: string }).file_path ?? (c.input as { command?: string }).command]);

describe("parseCodexRollout: token_usage_record (Codex >= 0.153)", () => {
  it("one turn per record, matching Codex's own test (120, 200, 30 -> 350)", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"),
      rec("u1", "response-a", usage(100, 0, 0, 20)), rec("u1", "response-b", usage(180, 0, 0, 20)), rec("u1", "response-c", usage(25, 0, 0, 5))]);
    expect(s.assistantTurns).toHaveLength(3);
    expect(sum(s)).toBe(350);
    expect(s.assistantTurns.map((t) => t.requestKey)).toEqual(["response-a", "response-b", "response-c"]);
  });

  it("treats cached and cache-write as parts of input, reasoning as part of output (Responses fixture 100/40/60/10/5)", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), rec("u1", "r1", usage(100, 40, 60, 10, 5))]);
    const t = s.assistantTurns[0]!;
    expect([t.inputTokens, t.cacheReadTokens, t.cacheCreationTokens, t.outputTokens, t.cacheCreation1hTokens]).toEqual([0, 40, 60, 10, 0]);
  });

  it("clamps inconsistent subsets so no field goes negative", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), rec("u1", "r1", { input_tokens: 50, cached_input_tokens: 80, cache_write_input_tokens: 10, output_tokens: 5 })]);
    const t = s.assistantTurns[0]!;
    expect([t.inputTokens, t.cacheReadTokens, t.cacheCreationTokens, t.outputTokens]).toEqual([0, 50, 0, 5]);
  });

  it("ignores token_count when records exist", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), rec("u1", "r1", usage(100, 0, 0, 10)), tc(usage(100, 0, 0, 10), usage(100, 0, 0, 10))]);
    expect(s.assistantTurns).toHaveLength(1);
  });

  it("counts a response_id seen twice in one file once", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), rec("u1", "r1", usage(100, 0, 0, 10)), rec("u1", "r1", usage(100, 0, 0, 10))]);
    expect(s.assistantTurns).toHaveLength(1);
    expect(sum(s)).toBe(110);
  });

  it("keys a record without response_id by the thread total, never by a shared placeholder", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), rec("u1", undefined, usage(100, 0, 0, 10), usage(100, 0, 0, 10))]);
    expect(s.assistantTurns[0]!.requestKey).toBe("codex:t1:rec:110:100:0:10");
    const bare = parse([ctx("u1", "gpt-6.1-sol"), rec("u1", undefined, usage(100, 0, 0, 10))]);
    expect(bare.assistantTurns).toHaveLength(1);
    expect(bare.assistantTurns[0]!.requestKey).toBeUndefined();
  });

  it("takes the model from the record's turn", () => {
    const s = parse([meta(), ctx("u1", "gpt-5.4"), ctx("u2", "gpt-6.1-sol"), rec("u1", "r1", usage(10, 0, 0, 1)), rec("u2", "r2", usage(10, 0, 0, 1))]);
    expect(s.assistantTurns.map((t) => t.model)).toEqual(["gpt-5.4", "gpt-6.1-sol"]);
  });

  it("keeps token_count turns logged before the first record (file resumed under newer Codex)", () => {
    const a = usage(100, 0, 0, 10);
    const s = parse([meta(), ctx("u1", "gpt-5.4"), tc(a, a), ctx("u2", "gpt-6.1-sol"),
      rec("u2", "r1", usage(200, 100, 0, 20), usage(300, 100, 0, 30)), tc(usage(300, 100, 0, 30), usage(200, 100, 0, 20))]);
    expect(s.assistantTurns.map((t) => t.requestKey)).toEqual(["codex:t1:110:100:0:10", "r1"]);
    expect(sum(s)).toBe(330);
  });

  it("drops a token_count turn that the first record already covers", () => {
    const a = usage(100, 0, 0, 10);
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), tc(a, a), rec("u1", "r1", a, a)]);
    expect(s.assistantTurns.map((t) => t.requestKey)).toEqual(["r1"]);
    expect(sum(s)).toBe(110);
  });
});

describe("parseCodexRollout: token_count fallback (older Codex)", () => {
  it("skips repeated identical totals (duplicate events)", () => {
    const a = usage(100, 0, 0, 10), b = usage(250, 50, 0, 30);
    const s = parse([meta(), ctx("u1", "gpt-5.4"), tc(a, a), tc(a, a), tc(b, usage(150, 50, 0, 20)), tc(b, usage(150, 50, 0, 20))]);
    expect(s.assistantTurns).toHaveLength(2);
    expect(sum(s)).toBe(280);
    expect(s.assistantTurns[1]!.inputTokens).toBe(100);
    expect(s.assistantTurns[1]!.cacheReadTokens).toBe(50);
  });

  it("skips info:null and zero-usage estimate events", () => {
    const a = usage(100, 0, 0, 10);
    const s = parse([meta(), ctx("u1", "gpt-5.4"), L("event_msg", { type: "token_count", info: null }), tc(a, a),
      tc({ ...a, total_tokens: 400 }, { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 290 })]);
    expect(s.assistantTurns).toHaveLength(1);
  });

  it("bills the cumulative change when last_token_usage is an estimate (real-log case)", () => {
    // Real rollout: the counter grew by a real request (input 114525, cached 114048,
    // output 335) while last_token_usage held a zero-usage estimate of 118351.
    const prev = { input_tokens: 4930688, cached_input_tokens: 4638592, output_tokens: 30960, total_tokens: 4961648 };
    const T = { input_tokens: 5045213, cached_input_tokens: 4752640, output_tokens: 31295, total_tokens: 5076508 };
    const est = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 118351 };
    const s = parse([meta(), ctx("u1", "gpt-5.4"), tc(prev, prev), tc(T, est), tc(T, est)]);
    expect(s.assistantTurns).toHaveLength(2);
    const t = s.assistantTurns[1]!;
    expect([t.inputTokens, t.cacheReadTokens, t.outputTokens]).toEqual([114525 - 114048, 114048, 335]);
    expect(sum(s)).toBe(5076508);
  });

  it("resets the baseline when the cumulative total goes backwards", () => {
    const a = usage(100, 0, 0, 10), reset = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 50 };
    const c = { ...usage(120, 0, 0, 10), total_tokens: 80 };
    const s = parse([meta(), ctx("u1", "gpt-5.4"), tc(a, a), tc(reset, reset), tc(c, usage(20, 0, 0, 10))]);
    expect(s.assistantTurns).toHaveLength(2);
  });

  it("keys legacy turns by root session + cumulative total, so fork copies dedupe", () => {
    const a = usage(100, 0, 0, 10);
    const s = parse([meta(), ctx("u1", "gpt-5.4"), tc(a, a)]);
    expect(s.assistantTurns[0]!.requestKey).toBe("codex:t1:110:100:0:10");
    const sub = parse([meta({ id: "child", session_id: "t1" }), ctx("u1", "gpt-5.4"), tc(a, a)]);
    expect(sub.assistantTurns[0]!.requestKey).toBe("codex:t1:110:100:0:10");
  });

  it("leaves requestKey undefined without a session id", () => {
    const a = usage(100, 0, 0, 10);
    const s = parse([ctx("u1", "gpt-5.4"), tc(a, a)]);
    expect(s.assistantTurns).toHaveLength(1);
    expect(s.assistantTurns[0]!.requestKey).toBeUndefined();
  });
});

describe("parseCodexRollout: tools", () => {
  it("turns single-file shell reads into Read calls with an absolute path, sized by their output", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), fc("shell_command", { command: "Get-Content -Raw src/a.ts", workdir: "C:\\p" }, "c1"),
      out("c1", "x".repeat(400)), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls.map((c) => [c.name, (c.input as { file_path?: string }).file_path, c.resultTokens])).toEqual([["Read", "C:\\p\\src\\a.ts", 100]]);
  });

  it("keeps partial reads distinct and resolves them against the session cwd", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), fc("exec_command", { cmd: "sed -n '1,40p' a.ts" }, "c1"), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect((s.toolCalls[0]!.input as { file_path: string }).file_path).toBe("C:\\p\\a.ts#1-40");
  });

  it("resolves C:\\p\\a.ts, C:/p/a.ts and a.ts with workdir C:\\p to the same normalized path", () => {
    const s = parse([meta({ cwd: "D:\\elsewhere" }), ctx("u1", "gpt-6.1-sol", "D:\\elsewhere"),
      fc("shell_command", { command: "Get-Content C:\\p\\a.ts" }, "c1"),
      fc("shell_command", { command: "cat C:/p/a.ts" }, "c2"),
      fc("shell_command", { command: "cat a.ts", workdir: "C:\\p" }, "c3"),
      fc("shell_command", { command: "cat ./sub/../a.ts", workdir: "C:\\p" }, "c4"),
      rec("u1", "r1", usage(10, 0, 0, 1))]);
    const paths = s.toolCalls.map((c) => normalizeFilePath((c.input as { file_path: string }).file_path));
    expect(s.toolCalls.every((c) => c.name === "Read")).toBe(true);
    expect(new Set(paths)).toEqual(new Set(["c:/p/a.ts"]));
  });

  it("resolves a relative workdir against the turn cwd, and POSIX paths with path.posix", () => {
    const s = parse([meta({ cwd: "/home/u/proj" }), ctx("u1", "gpt-6.1-sol", "/home/u/proj"),
      fc("exec_command", { cmd: "cat lib/x.ts", workdir: "pkg" }, "c1"),
      fc("shell", { command: ["bash", "-lc", "cat /etc/hosts"] }, "c2"),
      rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(names(s)).toEqual([["Read", "/home/u/proj/pkg/lib/x.ts"], ["Read", "/etc/hosts"]]);
  });

  it("leaves a relative path alone when no absolute base is known", () => {
    const s = parse([L("session_meta", { id: "t1" }), fc("exec_command", { cmd: "cat a.ts" }, "c1"), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(names(s)).toEqual([["Read", "a.ts"]]);
  });

  it("a read whose output shows a non-zero exit code stays a Bash call (no false duplicate on retry)", () => {
    const { session: s, stats } = parseCodexRolloutWithStats([meta(), ctx("u1", "gpt-6.1-sol"),
      fc("shell_command", { command: "Get-Content README.md", workdir: "C:\\p" }, "c1"),
      out("c1", "Exit code: 1\nWall time: 0.9 seconds\nOutput:\nGet-Content : Cannot find path 'C:\\p\\README.md' because it does not exist."),
      fc("shell_command", { command: "Get-Content README.md", workdir: "C:\\p" }, "c2"),
      out("c2", "Exit code: 0\nWall time: 0.4 seconds\nOutput:\n# Title\n"),
      rec("u1", "r1", usage(10, 0, 0, 1))].join("\n"));
    expect(names(s)).toEqual([["Bash", "Get-Content README.md"], ["Read", "C:\\p\\README.md"]]);
    expect(stats.failedReads).toBe(1);
  });

  it("recognises aborted, legacy-JSON and exec-wrapper failures", () => {
    expect(shellOutputFailed("Exit code: 124\nWall time: 24.6 seconds\nOutput:\ncommand timed out")).toBe(true);
    expect(shellOutputFailed("Exit code: 0\nWall time: 1 seconds\nOutput:\nGet-Content : Cannot find path")).toBe(false);
    expect(shellOutputFailed("Wall time: 808.5 seconds\naborted by user")).toBe(true);
    expect(shellOutputFailed(JSON.stringify({ output: "cat: a: No such file or directory", metadata: { exit_code: 1, duration_seconds: 0.1 } }))).toBe(true);
    expect(shellOutputFailed(JSON.stringify({ output: "x", metadata: { exit_code: 0, duration_seconds: 0.1 } }))).toBe(false);
    expect(shellOutputFailed("Script failed\nWall time 0.0 seconds\nOutput:\nScript error:\nboom")).toBe(true);
    expect(shellOutputFailed("Script completed\nWall time 1.0 seconds\nOutput:\n# file body\n")).toBe(false);
    expect(shellOutputFailed("Script completed\nWall time 1.0 seconds\nOutput:\nGet-Content: Cannot find path 'C:\\x' because it does not exist.")).toBe(true);
    expect(shellOutputFailed('Script completed\nWall time 1.4 seconds\nOutput:\n{"chunk_id":"d3","exit_code":1,"output":""}')).toBe(true);
    expect(shellOutputFailed('Script completed\nWall time 1.4 seconds\nOutput:\n{"chunk_id":"d3","exit_code":0,"output":"hi"}')).toBe(false);
    expect(shellOutputFailed("plain file text mentioning a path that does not exist")).toBe(false);
    // PowerShell 7 (real log): coloured, message on a "| ..." line below "Get-Content:".
    const pwsh7 = "\u001b[31;1mGet-Content: \u001b[0m\r\n\u001b[31;1m\u001b[36;1mLine |\u001b[0m\r\n\u001b[36;1m   2 | \u001b[0m \u001b[36;1mGet-Content package.json\u001b[0m\r\n" +
      "\u001b[36;1m     | \u001b[31;1m ~~~~~~~~~~~~~~~~~~~~~~~~\u001b[0m\r\n\u001b[36;1m     | \u001b[31;1mCannot find path 'C:\\p\\package.json' because it does not exist.\u001b[0m\r\n";
    expect(shellOutputFailed("Script completed\nWall time 1.0 seconds\nOutput:\n" + pwsh7)).toBe(true);
    expect(shellOutputFailed("Script completed\nWall time 1.0 seconds\nOutput:\nGet-Content:\nnot an error block\n")).toBe(false);
  });

  it("extracts commands from the JavaScript exec wrapper and treats them like exec_command", () => {
    const code = 'const r = await tools.exec_command({"cmd":"Get-Content -Raw \'.agents\\\\plugins\\\\marketplace.json\'","workdir":"C:\\\\Projects\\\\Sipcode","yield_time_ms":10000});\ntext(r.output);\n';
    expect(execWrappedCommands(code)).toEqual([{ cmd: "Get-Content -Raw '.agents\\plugins\\marketplace.json'", workdir: "C:\\Projects\\Sipcode", yield_time_ms: 10000 }]);
    const { session: s, stats } = parseCodexRolloutWithStats([meta(), ctx("u1", "gpt-6.1-sol"),
      L("response_item", { type: "custom_tool_call", name: "exec", input: code, call_id: "e1" }),
      cout("e1", "Script completed\nWall time 1.4 seconds\nOutput:\n" + "y".repeat(360)),
      rec("u1", "r1", usage(10, 0, 0, 1))].join("\n"));
    expect(names(s)).toEqual([["Read", "C:\\Projects\\Sipcode\\.agents\\plugins\\marketplace.json"]]);
    expect(s.toolCalls[0]!.resultTokens).toBe(Math.ceil(("Script completed\nWall time 1.4 seconds\nOutput:\n".length + 360) / 4));
    expect(stats.execWrappedCommands).toBe(1);
  });

  it("splits an exec script with several commands; a script without commands keeps its own name", () => {
    const code = 'await tools.exec_command({"cmd":"npm test"}); await tools.exec_command({"cmd":"cat a.ts","workdir":"C:\\\\p"}); const x = "tools.exec_command({";';
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"),
      L("response_item", { type: "custom_tool_call", name: "exec", input: code, call_id: "e1" }),
      L("response_item", { type: "custom_tool_call", name: "exec", input: "text(ALL_TOOLS)", call_id: "e2" }),
      rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls.map((c) => c.name)).toEqual(["Bash", "Read", "exec"]);
    expect((s.toolCalls[1]!.input as { file_path: string }).file_path).toBe("C:\\p\\a.ts");
  });

  it("a failed exec-wrapped read stays Bash", () => {
    const code = 'const r = await tools.exec_command({"cmd":"Get-Content -Raw missing.md","workdir":"C:\\\\p"}); text(r.output);';
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"),
      L("response_item", { type: "custom_tool_call", name: "exec", input: code, call_id: "e1" }),
      cout("e1", "Script completed\nWall time 0.8 seconds\nOutput:\nGet-Content: Cannot find path 'C:\\p\\missing.md' because it does not exist."),
      rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls.map((c) => c.name)).toEqual(["Bash"]);
  });

  it("maps apply_patch to one Edit per file, resolved against the cwd", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: C:\\q\\b.ts\n+z\n*** End Patch";
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), L("response_item", { type: "custom_tool_call", name: "apply_patch", input: patch, call_id: "p1" }), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(names(s)).toEqual([["Edit", "C:\\p\\src\\a.ts"], ["Edit", "C:\\q\\b.ts"]]);
  });

  it("maps legacy shell apply_patch argv and local_shell_call", () => {
    const patch = "*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** End Patch";
    const s = parse([meta({ cwd: "/w" }), ctx("u1", "gpt-5.4", "/w"),
      fc("shell", { command: ["apply_patch", patch], workdir: "/w/pkg" }, "s1"),
      L("response_item", { type: "local_shell_call", call_id: "l1", status: "completed", action: { type: "exec", command: ["bash", "-lc", "head -n 5 b.ts"], working_directory: "/w/sub" } }),
      rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(names(s)).toEqual([["Edit", "/w/pkg/a.ts"], ["Read", "/w/sub/b.ts#1-5"]]);
  });

  it("other commands stay Bash calls", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), fc("exec_command", { cmd: "npm test" }, "c1"), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls[0]!.name).toBe("Bash");
  });

  it("drops a repeated call_id (copied history)", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), fc("exec_command", { cmd: "cat a.ts" }, "c1"), fc("exec_command", { cmd: "cat a.ts" }, "c1"), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls).toHaveLength(1);
  });

  it("attaches calls to the next turn after them; leftovers go to the last turn", () => {
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"),
      fc("exec_command", { cmd: "npm test" }, "c1"), rec("u1", "r1", usage(10, 0, 0, 1)),
      fc("exec_command", { cmd: "npm run build" }, "c2"), rec("u1", "r2", usage(10, 0, 0, 1)),
      fc("exec_command", { cmd: "npm run lint" }, "c3")]);
    expect(s.assistantTurns.map((t) => t.toolCalls.map((c) => c.id))).toEqual([["c1"], ["c2", "c3"]]);
    expect(s.toolCalls.map((c) => c.assistantTurnIndex)).toEqual([0, 1, 1]);
  });

  it("drops calls when the file has no turns, without crashing", () => {
    const { session: s, stats } = parseCodexRolloutWithStats([meta(), ctx("u1", "gpt-6.1-sol"), fc("exec_command", { cmd: "cat a.ts" }, "c1"), out("c1", "x")].join("\n"));
    expect(s.assistantTurns).toHaveLength(0);
    expect(s.toolCalls).toHaveLength(0);
    expect(stats.droppedCalls).toBe(1);
  });

  it("sizes an output once even when several calls share its call_id", () => {
    const patch = "*** Begin Patch\n*** Update File: a.ts\n*** Update File: b.ts\n*** End Patch";
    const s = parse([meta(), ctx("u1", "gpt-6.1-sol"), L("response_item", { type: "custom_tool_call", name: "apply_patch", input: patch, call_id: "p1" }),
      cout("p1", "z".repeat(40)), rec("u1", "r1", usage(10, 0, 0, 1))]);
    expect(s.toolCalls.map((c) => c.resultTokens)).toEqual([10, 0]);
  });
});

describe("parseCodexRollout: session fields", () => {
  it("reads cwd, agent, subagent flag and counts user turns from turn_context", () => {
    const s = parse([meta({ source: { subagent: { thread_spawn: { parent_thread_id: "p0" } } } }), ctx("u1", "gpt-6.1-sol"), ctx("u2", "gpt-6.1-sol"), rec("u1", "r1", usage(1, 0, 0, 1))]);
    expect(s.cwd).toBe("C:\\p");
    expect(s.agent).toBe("codex");
    expect(s.isSubagent).toBe(true);
    expect(s.userTurnCount).toBe(2);
    expect(s.sessionId).toBe("t1");
    expect(s.primaryModel).toBe("gpt-6.1-sol");
  });

  it("tolerates malformed lines and empty input", () => {
    const s = parse([meta(), "{not json", "[1,2]", ctx("u1", "gpt-6.1-sol"), rec("u1", "r1", usage(1, 0, 0, 1))]);
    expect(s.linesSkipped).toBe(2);
    expect(s.assistantTurns).toHaveLength(1);
    expect(parse([""]).assistantTurns).toHaveLength(0);
  });

  it("parseCodexMeta reads line 1 only", () => {
    const m = parseCodexMeta([meta(), meta({ cwd: "C:\\other" })].join("\n"));
    expect(m.cwd).toBe("C:\\p");
    expect(m.cliVersion).toBe("0.160.0");
    expect(m.rootSessionId).toBe("t1");
    expect(parseCodexMeta(ctx("u1", "x")).isSubagent).toBe(false);
  });
});
