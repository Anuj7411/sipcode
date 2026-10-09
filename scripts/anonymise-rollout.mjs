// Turns a real Codex rollout into a test fixture (dev only, not shipped).
// Usage: npm run build && node scripts/anonymise-rollout.mjs <in.jsonl> <out.jsonl> [--seed <n>] [--max-bytes <n>]
//
// Keeps: line types, payload types, every number (token counts, rate limits),
// model ids, tool names, cli_version, booleans, the JSON structure of the lines
// Sipcode reads (session_meta: ids, cwd, cli_version, source only; lines it
// does not read keep only their payload type).
// Replaces: every other string with "x"; object keys that are not snake_case
// names (file paths used as keys) with k<n>; tool outputs with "x" repeated to the
// same length (result sizes stay); ids with fake ones (consistently, so
// duplicates and forks still match); timestamps shifted to start at
// 2026-01-01T00:00:00Z, and epoch numbers in *_at / *_time fields (rate-limit
// resets, message create times) by the same amount; every cwd with C:\fixture. Shell commands become "x",
// except detected reads and patches, which become a synthetic command on a fake
// file (file<n>.ts, one per real path) so read / re-read / edit detection is
// still exercised. Uses Sipcode's own parser (dist/) to know which calls were
// reads. With --max-bytes, cuts the output before a turn_context line so it
// stays under the limit. Prints numbers only.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const { parseCodexRolloutWithStats, execWrappedCommands } = await import(
  pathToFileURL(join(DIST, "modules", "agents", "codex", "parse.js")).href
);

export const FIXTURE_CWD = "C:\\fixture";
const START = Date.parse("2026-01-01T00:00:00.000Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_KEYS = new Set(["id", "session_id", "thread_id", "parent_thread_id", "forked_from_id", "conversation_id"]);
const KEEP_KEYS = new Set(["type", "model", "cli_version"]);
const RANGE = /#(\d+-\d+|tail:\d+)$/;
// session_meta fields kept (anonymised); the rest (instructions, git, originator, tools...) is dropped.
const META_KEYS = ["id", "session_id", "timestamp", "cwd", "cli_version", "source", "parent_thread_id", "forked_from_id"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(o, k)).map((k) => [k, o[k]]));
/** Lines Sipcode reads keep their (anonymised) payload; every other line keeps only its payload type. */
const readByParser = (type, payloadType) =>
  ["session_meta", "turn_context", "response_item", "token_usage_record", "compacted"].includes(type) ||
  (type === "event_msg" && payloadType === "token_count");

export function anonymiseRollout(text, { seed = 1, maxBytes = Infinity } = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const { session } = parseCodexRolloutWithStats(lines.join("\n"));

  // What Sipcode made of each call: Read / Edit targets per call_id.
  const callsById = new Map();
  for (const c of session.toolCalls) {
    if (!c.id) continue;
    const list = callsById.get(c.id) ?? [];
    list.push(c);
    callsById.set(c.id, list);
  }

  const fakeFiles = new Map();
  const fakeFile = (p) => {
    const k = p.replace(/\\/g, "/").toLowerCase();
    if (!fakeFiles.has(k)) fakeFiles.set(k, `file${fakeFiles.size + 1}.ts`);
    return fakeFiles.get(k);
  };
  const maps = { id: new Map(), call: new Map(), response: new Map(), turn: new Map() };
  const hex = (n, w) => n.toString(16).padStart(w, "0");
  const fakeId = (v) => {
    if (!maps.id.has(v)) maps.id.set(v, `019b${hex(seed, 4)}-${hex(maps.id.size + 1, 4)}-7000-8000-000000000000`);
    return maps.id.get(v);
  };
  const mapped = (m, prefix, v) => {
    if (!m.has(v)) m.set(v, `${prefix}${m.size + 1}`);
    return m.get(v);
  };

  // Log keys are snake_case names; anything else is data used as a key (a
  // file path in a patch's "changes" map, for one) and is replaced.
  const keyMap = new Map();
  const fakeKey = (k) => {
    if (/^[a-z_][a-z0-9_]{0,63}$/.test(k)) return k;
    if (!keyMap.has(k)) keyMap.set(k, `k${keyMap.size + 1}`);
    return keyMap.get(k);
  };

  let shift;
  const time = (v) => {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) return "x";
    shift ??= START - t;
    return new Date(t + shift).toISOString();
  };

  // Epoch numbers (rate_limits resets_at, message create_time) move by the same
  // shift as the ISO timestamps, so no absolute real time survives.
  const epoch = (v) => {
    const isMs = v >= 1e11;
    shift ??= START - (isMs ? v : v * 1000);
    if (isMs) return v + shift;
    return Number.isInteger(v) ? v + Math.round(shift / 1000) : v + shift / 1000;
  };

  /** Every string becomes "x" except kept keys, ids, cwd and timestamps. */
  const anon = (v, key) => {
    if (typeof v === "number" && v > 1e9 && /(^|_)(at|time)$/.test(key ?? "")) return epoch(v);
    if (typeof v === "string") {
      if (KEEP_KEYS.has(key)) return v;
      if (key === "cwd") return FIXTURE_CWD;
      if (key === "timestamp") return time(v);
      if (ID_KEYS.has(key) && UUID.test(v)) return fakeId(v);
      if (key === "call_id") return mapped(maps.call, "c", v);
      if (key === "response_id") return mapped(maps.response, "r", v);
      if (key === "turn_id") return mapped(maps.turn, "t", v);
      return "x";
    }
    if (Array.isArray(v)) return v.map((x) => anon(x, key));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [fakeKey(k), anon(x, k)]));
    return v;
  };
  const sameLength = (o) =>
    typeof o === "string"
      ? "x".repeat(o.length)
      : Array.isArray(o)
        ? o.map((b) =>
            b && typeof b === "object" && typeof b.text === "string"
              ? { ...anon(b), text: "x".repeat(b.text.length) }
              : anon(b),
          )
        : anon(o);

  const readCmd = (c) => {
    const p = c.input.file_path;
    const m = RANGE.exec(p);
    const f = fakeFile(m ? p.slice(0, m.index) : p);
    if (!m) return `cat ${f}`;
    if (m[1].startsWith("tail:")) return `tail -n ${m[1].slice(5)} ${f}`;
    const [a, b] = m[1].split("-");
    return `sed -n '${a},${b}p' ${f}`;
  };
  const patch = (edits) =>
    `*** Begin Patch\n${edits.map((c) => `*** Update File: ${fakeFile(c.input.file_path)}\n`).join("")}*** End Patch`;
  /** One shell command standing in for what Sipcode saw in this call. */
  const shellFor = (calls) => {
    if (calls.length === 1 && calls[0].name === "Read") return readCmd(calls[0]);
    if (calls.length && calls.every((c) => c.name === "Edit")) return `apply_patch "${patch(calls)}"`;
    return "x";
  };

  const toolCall = (p) => {
    const calls = callsById.get(p.call_id) ?? [];
    const out = anon(p);
    if (typeof p.name === "string") out.name = p.name;
    let args = {};
    try {
      const v = typeof p.arguments === "string" ? JSON.parse(p.arguments) : undefined;
      if (v && typeof v === "object" && !Array.isArray(v)) args = v;
    } catch {
      /* not JSON: stays a plain call */
    }
    if (p.type === "local_shell_call" && Array.isArray(p.action?.command)) {
      const edits = calls.every((c) => c.name === "Edit") && calls.length;
      out.action = {
        ...anon(p.action ?? {}),
        command: edits ? ["apply_patch", patch(calls)] : ["bash", "-lc", shellFor(calls)],
      };
      delete out.action.working_directory;
      return out;
    }
    if (p.type === "function_call") {
      if (p.name === "exec_command" && typeof args.cmd === "string")
        out.arguments = JSON.stringify({ cmd: shellFor(calls) });
      else if (p.name === "shell_command" && typeof args.command === "string")
        out.arguments = JSON.stringify({ command: shellFor(calls) });
      else if ((p.name === "shell" || p.name === "container.exec") && Array.isArray(args.command)) {
        const edits = calls.length && calls.every((c) => c.name === "Edit");
        out.arguments = JSON.stringify({
          command: edits ? ["apply_patch", patch(calls)] : ["bash", "-lc", shellFor(calls)],
        });
      } else if (p.name === "apply_patch") out.arguments = JSON.stringify({ input: calls.length ? patch(calls) : "x" });
      return out;
    }
    if (p.type === "custom_tool_call") {
      const wrapped =
        typeof p.input === "string" ? execWrappedCommands(p.input).filter((a) => typeof a.cmd === "string") : [];
      if (p.name === "exec" && wrapped.length) {
        out.input = calls
          .map(
            (c) =>
              `await tools.exec_command(${JSON.stringify({ cmd: c.name === "Read" ? readCmd(c) : c.name === "Edit" ? `apply_patch "${patch([c])}"` : "x" })});`,
          )
          .join("\n");
      } else if (p.name === "apply_patch" && calls.length) out.input = patch(calls);
    }
    return out;
  };

  const out = [];
  let bytes = 0;
  let lastCut = 0;
  let cutLines = lines.length;
  for (let i = 0; i < lines.length; i++) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      e = undefined;
    }
    let line;
    if (!e || typeof e !== "object" || Array.isArray(e)) line = JSON.stringify("x");
    else {
      const { payload, ...top } = e;
      const o = anon(top);
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const t = payload.type;
        if (!readByParser(e.type, t)) o.payload = typeof t === "string" ? { type: t } : {};
        else if (e.type === "session_meta") o.payload = anon(pick(payload, META_KEYS));
        else if (
          e.type === "response_item" &&
          (t === "function_call" || t === "custom_tool_call" || t === "local_shell_call")
        )
          o.payload = toolCall(payload);
        else if (e.type === "response_item" && (t === "function_call_output" || t === "custom_tool_call_output")) {
          o.payload = { ...anon(payload), output: sameLength(payload.output) };
        } else o.payload = anon(payload);
      } else if (payload !== undefined) o.payload = anon(payload);
      line = JSON.stringify(o);
    }
    if (e?.type === "turn_context") lastCut = i;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > maxBytes) {
      cutLines = lastCut;
      out.length = lastCut;
      break;
    }
    out.push(line);
  }
  return { text: out.join("\n") + "\n", lines: cutLines, fakeFiles: fakeFiles.size };
}

function summary(text) {
  const { session } = parseCodexRolloutWithStats(text);
  const reads = session.toolCalls.filter((c) => c.name === "Read");
  const seen = new Set();
  let reReads = 0;
  for (const c of reads) {
    const k = c.input.file_path.replace(/\\/g, "/").toLowerCase();
    if (seen.has(k)) reReads++;
    seen.add(k);
  }
  return {
    turns: session.assistantTurns.length,
    tokens: session.assistantTurns.reduce(
      (a, t) => a + t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens,
      0,
    ),
    output: session.assistantTurns.reduce((a, t) => a + t.outputTokens, 0),
    calls: session.toolCalls.length,
    reads: reads.length,
    reReads,
    edits: session.toolCalls.filter((c) => c.name === "Edit").length,
    resultTokens: session.toolCalls.reduce((a, c) => a + c.resultTokens, 0),
    subagent: session.isSubagent,
    userTurns: session.userTurnCount,
    durationSec: session.durationSec,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  const opt = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? Number(process.argv[i + 1]) : undefined;
  };
  if (!input || !output) {
    console.error("usage: node scripts/anonymise-rollout.mjs <in.jsonl> <out.jsonl> [--seed <n>] [--max-bytes <n>]");
    process.exit(2);
  }
  const original = readFileSync(input, "utf8");
  const r = anonymiseRollout(original, { seed: opt("--seed") ?? 1, maxBytes: opt("--max-bytes") ?? Infinity });
  writeFileSync(output, r.text);
  const prefix = original
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, r.lines)
    .join("\n");
  const before = summary(prefix);
  const after = summary(r.text);
  console.log(`lines kept ${r.lines}, bytes ${Buffer.byteLength(r.text)}, fake files ${r.fakeFiles}`);
  let same = true;
  for (const k of Object.keys(before)) {
    const ok = before[k] === after[k];
    same &&= ok;
    console.log(`${ok ? "same" : "DIFF"} ${k}: original ${before[k]}, fixture ${after[k]}`);
  }
  process.exit(same ? 0 : 1);
}
