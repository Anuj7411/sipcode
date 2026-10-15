// Independent token counter for Claude Code and Codex logs (dev only, not shipped).
// Imports nothing from src/ or dist/; it only reads the bundled price tables
// (src/lib/pricing/*.json, plain data) and runs dist/cli.js as a subprocess.
//
// Usage: npm run build && node scripts/verify-counts.mjs [--why <n>]
// Reads SIPCODE_PROJECTS_DIR / CODEX_HOME like Sipcode does (defaults:
// ~/.claude/projects, ~/.codex) and passes the same folders to Sipcode, so it
// can be pointed at a frozen copy of the logs. Sipcode runs with a temporary
// HOME, so its usage cache starts cold; every command runs twice (cold, warm).
// Prints numbers only (never message text, paths or commands). Exit 1 on any
// mismatch.
//
// Rules re-implemented here (from the Claude Code / Codex log formats):
// - Claude Code writes one line per content block and repeats the request's
//   usage on each; a request is message.id + "|" + requestId, and the largest
//   value per usage field wins. Cache write = max(cache_creation_input_tokens,
//   nested 5m + 1h). Observer folders (claude-mem) are not sessions.
// - Codex: token_usage_record lines are per request (key response_id). Older
//   files only have token_count events carrying a cumulative total T: skip
//   info:null and repeats (T == previous), start a new baseline when T goes
//   backwards, bill T - previous field by field. Cached and cache-write input
//   are subsets of input_tokens.
// - A request copied into another file (resumed session, fork) belongs to the
//   file that started first; copies are dropped, and the kept copy carries the
//   largest value per field across all copies.
// - Days: today = local calendar day; stats/trend/baseline buckets = UTC days.
// - Codex limits (`limits --json --since all`): a reading is payload.rate_limits
//   on an event_msg / token_count line, one per non-null window (resets_at in
//   epoch seconds; above 1e12 already ms). Readings sorted by time, reset time,
//   percent. Window = limit_id + window_minutes. Stale readings are skipped:
//   one logged after its own reset time, and one whose reset time is more than
//   15 min earlier than the open period's. A new period starts when the reset
//   time moves by more than max(15 min, 1% of the window), when the reading is
//   past the period's reset time, or when the reset time moves more than 15 min
//   later while the percent is below the period's running maximum. Period
//   start = min(newest reset time minus the window, first reading), but never
//   before the previous period's newest reading. A rise of the running maximum
//   is shared by the requests since the previous rise, by tokens; with none it
//   is unattributed. Tokens per 1%: finished periods (not the window's last, or
//   reset before the newest reading), 20% or more used, 90% or more of tokens
//   from one model; a cut is the first period at or below half the median of
//   2+ earlier ones (same model).
// - Regress (`regress --json`): Claude Code requests with usage, a `version`
//   and a model other than <synthetic>; the kept copy is the owner's with the
//   largest usage; automated = isSidechain or entrypoint sdk-*; 5-minute write
//   = write - 1h when the nested split was logged; the prototype's five checks
//   and thresholds (min n 20). Codex: per (line 1 cli_version without
//   pre-release, model, plan of the period's newest reading, limit, window),
//   the percent its requests were charged rise by rise (by tokens), per 1M
//   uncached input + output tokens; groups of 200,000+ such tokens; flagged
//   at 2x the upper median of the others on the same plan, limit and window.
// - Codex compresses older rollouts to rollout-*.jsonl.zst. They are decoded
//   here with node:zlib directly, frame by frame (Node's decoder stops after
//   the first frame), and each frame must be complete. One log per rollout
//   name: the plain .jsonl when both exist, else sessions/ before
//   archived_sessions/. Without zstd in this Node the script stops (it would
//   otherwise agree with a Sipcode that skips them).
import { zstdDecompressSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "dist", "cli.js");
const DAY = 86_400_000;
const args = process.argv.slice(2);
const WHY_SAMPLES = (args.includes("--why") && Number(args[args.indexOf("--why") + 1])) || 6;

const CLAUDE_ROOT = process.env.SIPCODE_PROJECTS_DIR || join(homedir(), ".claude", "projects");
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");

let failures = 0;
const fmt = (n) =>
  typeof n === "number" ? (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(6)) : String(n);
function check(label, mine, theirs, tol = 0, source = "sipcode") {
  const ok = typeof mine === "number" && typeof theirs === "number" ? Math.abs(mine - theirs) <= tol : mine === theirs;
  if (!ok) failures++;
  console.log(`${ok ? "MATCH   " : "MISMATCH"} ${label}: independent ${fmt(mine)}, ${source} ${fmt(theirs)}`);
  return ok;
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const ms = (iso) => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
};

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

const PRICE_DIR = join(REPO, "src", "lib", "pricing");
const priceFiles = readdirSync(PRICE_DIR);
const DATED = priceFiles
  .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
  .sort()
  .map((n) => ({ date: n.slice(0, 10), models: JSON.parse(readFileSync(join(PRICE_DIR, n), "utf8")).models }));
const OPENAI_FILE = priceFiles
  .filter((n) => /^openai-\d{4}-\d{2}-\d{2}\.json$/.test(n))
  .sort()
  .at(-1);
const OPENAI = OPENAI_FILE ? JSON.parse(readFileSync(join(PRICE_DIR, OPENAI_FILE), "utf8")).models : {};
const tableMemo = new Map();

/** Prices in force on a UTC day: the newest dated table on or before it, gaps filled from the newest; OpenAI rows always current. */
function tableFor(day) {
  let t = tableMemo.get(day);
  if (t) return t;
  let chosen = DATED[0];
  for (const f of DATED) if (f.date <= day) chosen = f;
  t = { ...chosen.models };
  for (const [k, v] of Object.entries(DATED.at(-1).models)) if (!Object.hasOwn(t, k)) t[k] = v;
  for (const [k, v] of Object.entries(OPENAI)) if (!Object.hasOwn(t, k)) t[k] = v;
  tableMemo.set(day, t);
  return t;
}

const ALIASES = { "claude-opus-4-0": "claude-opus-4", "claude-sonnet-4-0": "claude-sonnet-4" };

function priceRow(table, model) {
  if (Object.hasOwn(table, model)) return table[model];
  const a = ALIASES[model];
  if (a && Object.hasOwn(table, a)) return table[a];
  let best;
  for (const k of Object.keys(table)) {
    if (model.startsWith(k) && /^-(\d{8}|\d{4}-\d{2}-\d{2})$/.test(model.slice(k.length))) {
      if (!best || k.length > best.length) best = k;
    }
  }
  return best ? table[best] : undefined;
}

/** USD for one request, or null when the model has no price. `inp` is uncached input. */
function requestCost(table, r) {
  if (!r.model) return null;
  const row = priceRow(table, r.model);
  if (!row) return null;
  const prompt = r.inp + r.cr + r.cw;
  const rate = row.long_prompt && prompt > row.long_prompt.over_tokens ? row.long_prompt : row;
  const oneHour = Math.min(r.cw1h, r.cw);
  const oneHourRate = rate.cache_creation_1h_per_mtok ?? rate.input_per_mtok * 2;
  return (
    (r.inp * rate.input_per_mtok +
      r.out * rate.output_per_mtok +
      r.cr * rate.cache_read_per_mtok +
      (r.cw - oneHour) * rate.cache_creation_per_mtok +
      oneHour * oneHourRate) /
    1e6
  );
}

const FIELDS = ["inp", "out", "cr", "cw", "cw1h"];
const tokensOf = (r) => r.inp + r.out + r.cr + r.cw;

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

function readClaudeFile(text) {
  const byKey = new Map();
  const requests = [];
  let start;
  let end;
  let lastUserTool = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"assistant"') && !line.includes('"user"')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object" || (e.type !== "assistant" && e.type !== "user")) continue;
    if (e.timestamp !== undefined && typeof e.timestamp !== "string") continue;
    if (e.sessionId !== undefined && typeof e.sessionId !== "string") continue;
    const ts = e.timestamp || undefined;
    if (ts) {
      if (!start || ts < start) start = ts;
      if (!end || ts > end) end = ts;
    }
    if (e.type !== "assistant") {
      const c = e.message && typeof e.message === "object" ? e.message.content : undefined;
      lastUserTool = Array.isArray(c) && c.some((b) => b && typeof b === "object" && b.type === "tool_result");
      continue;
    }
    const m = e.message && typeof e.message === "object" ? e.message : {};
    const u = m.usage && typeof m.usage === "object" ? m.usage : undefined;
    const nested = u?.cache_creation && typeof u.cache_creation === "object" ? u.cache_creation : {};
    const n5 = num(nested.ephemeral_5m_input_tokens);
    const n1 = num(nested.ephemeral_1h_input_tokens);
    const v = {
      inp: num(u?.input_tokens),
      out: num(u?.output_tokens),
      cr: num(u?.cache_read_input_tokens),
      cw: Math.max(num(u?.cache_creation_input_tokens), n5 + n1),
      cw1h: n1,
    };
    const key =
      typeof m.id === "string" && m.id ? `${m.id}|${typeof e.requestId === "string" ? e.requestId : ""}` : undefined;
    const split = !!(u?.cache_creation && typeof u.cache_creation === "object");
    const prev = key ? byKey.get(key) : undefined;
    if (prev) {
      for (const f of FIELDS) prev[f] = Math.max(prev[f], v[f]);
      prev.hasUsage ||= !!u;
      prev.split ||= split;
      continue;
    }
    const r = {
      key,
      model: typeof m.model === "string" ? m.model : undefined,
      ts,
      ...v,
      // regress: the request's tags (its first line wins, like Sipcode).
      version: typeof e.version === "string" && e.version ? e.version : undefined,
      entry: typeof e.entrypoint === "string" && e.entrypoint ? e.entrypoint : "?",
      side: e.isSidechain === true,
      afterTool: lastUserTool,
      hasUsage: !!u,
      split,
    };
    if (key) byKey.set(key, r);
    requests.push(r);
  }
  return { requests, start, end, turnCount: requests.length };
}

function readClaude() {
  const out = [];
  if (!existsSync(CLAUDE_ROOT)) return out;
  for (const d of readdirSync(CLAUDE_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || /-observer-sessions$/i.test(d.name) || /claude-mem-observer/i.test(d.name)) continue;
    const dir = join(CLAUDE_ROOT, d.name);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const p = join(dir, f.name);
      const st = statSync(p);
      out.push({
        id: f.name.slice(0, -6),
        project: d.name,
        mtimeMs: st.mtimeMs,
        ...readClaudeFile(readFileSync(p, "utf8")),
      });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

const usageVec = (u) => ({
  input: num(u?.input_tokens),
  cached: num(u?.cached_input_tokens),
  write: num(u?.cache_write_input_tokens),
  output: num(u?.output_tokens),
  total: num(u?.total_tokens),
});

/** Codex input counts cached and cache-write input as subsets; split into disjoint parts. */
function splitCodex(v) {
  const cached = Math.min(v.cached, v.input);
  const write = Math.min(v.write, v.input - cached);
  return { inp: v.input - cached - write, out: v.output, cr: cached, cw: write, cw1h: 0 };
}

function readCodexFile(text) {
  let meta;
  let start;
  let end;
  let model;
  const turnModel = new Map();
  const requests = [];
  const keys = new Set();
  let records = false;
  let prev;
  let resets = 0;
  let negativeFields = 0;
  let finalTotal;
  let finalThread;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object" || Array.isArray(e) || !e.payload || typeof e.payload !== "object") continue;
    const ts = typeof e.timestamp === "string" && e.timestamp ? e.timestamp : undefined;
    if (ts) {
      if (!start || ts < start) start = ts;
      if (!end || ts > end) end = ts;
    }
    const p = e.payload;
    if (e.type === "session_meta") {
      meta ??= p;
      continue;
    }
    const root =
      (typeof meta?.session_id === "string" && meta.session_id) ||
      (typeof meta?.id === "string" && meta.id) ||
      undefined;
    if (e.type === "turn_context") {
      if (typeof p.model === "string") {
        model = p.model;
        if (typeof p.turn_id === "string" && p.turn_id) turnModel.set(p.turn_id, p.model);
      }
      continue;
    }
    if (e.type === "token_usage_record") {
      const usage = usageVec(p.usage && typeof p.usage === "object" ? p.usage : {});
      const thread =
        p.thread_token_usage && typeof p.thread_token_usage === "object" ? usageVec(p.thread_token_usage) : undefined;
      if (thread) finalThread = thread.total;
      if (!records) {
        records = true;
        // Counter events logged before the first record (file resumed under a
        // newer Codex) stay only if the thread total puts them before it.
        if (thread) {
          const before = thread.total - usage.total;
          while (requests.length && requests.at(-1).cumulative !== undefined && requests.at(-1).cumulative > before)
            requests.pop();
        }
      }
      const key =
        (typeof p.response_id === "string" && p.response_id) ||
        (thread && root
          ? `codex:${root}:rec:${thread.total}:${thread.input}:${thread.cached}:${thread.output}`
          : undefined);
      if (key) {
        if (keys.has(key)) continue;
        keys.add(key);
      }
      const turnId = typeof p.turn_id === "string" && p.turn_id ? p.turn_id : undefined;
      requests.push({ key, model: (turnId && turnModel.get(turnId)) ?? model, ts, ...splitCodex(usage), raw: usage });
      continue;
    }
    if (e.type === "event_msg" && p.type === "token_count" && !records) {
      const T0 = p.info?.total_token_usage;
      if (!T0 || typeof T0 !== "object") continue;
      const T = usageVec(T0);
      finalTotal = T.total;
      if (
        prev &&
        T.input === prev.input &&
        T.cached === prev.cached &&
        T.output === prev.output &&
        T.total === prev.total
      )
        continue;
      if (prev && T.total < prev.total) {
        resets++;
        prev = T;
        continue;
      }
      const d = {};
      for (const f of ["input", "cached", "write", "output", "total"]) {
        const x = T[f] - (prev ? prev[f] : 0);
        if (x < 0) negativeFields++;
        d[f] = Math.max(0, x);
      }
      prev = T;
      if (d.input === 0 && d.output === 0 && d.cached === 0) continue;
      const key = root ? `codex:${root}:${T.total}:${T.input}:${T.cached}:${T.output}` : undefined;
      if (key) {
        if (keys.has(key)) continue;
        keys.add(key);
      }
      requests.push({ key, model, ts, ...splitCodex(d), raw: d, cumulative: T.total });
    }
  }
  const sub =
    meta &&
    ((meta.source && typeof meta.source === "object" && "subagent" in meta.source) ||
      typeof meta.parent_thread_id === "string");
  return {
    metaId: typeof meta?.id === "string" && meta.id ? meta.id : undefined,
    cliVersion: typeof meta?.cli_version === "string" && meta.cli_version ? meta.cli_version : undefined,
    isSubagent: !!sub,
    requests,
    start,
    end,
    turnCount: requests.length,
    records,
    resets,
    negativeFields,
    groundTruth: records ? finalThread : finalTotal,
  };
}

/**
 * Decode a .zst rollout: split into frames by walking their headers (RFC 8878
 * 3.1), decode each, check each decoded size against its header, concatenate.
 * Throws on anything incomplete.
 */
function decodeZst(buf) {
  if (typeof zstdDecompressSync !== "function") {
    throw new Error(`compressed Codex logs need Node.js 22.15 or newer to verify (this is ${process.version})`);
  }
  const parts = [];
  let p = 0;
  while (p < buf.length) {
    const magic = buf.readUInt32LE(p);
    if (((magic & 0xfffffff0) >>> 0) === 0x184d2a50) {
      p += 8 + buf.readUInt32LE(p + 4);
      continue;
    }
    if (magic !== 0xfd2fb528) throw new Error("not a zstd frame");
    const start = p;
    const fhd = buf[p + 4];
    const single = (fhd >> 5) & 1;
    const fcsLen = [single, 2, 4, 8][fhd >> 6];
    p += 5 + (single ? 0 : 1) + [0, 1, 2, 4][fhd & 3];
    const fcs =
      fcsLen === 1 ? buf[p] : fcsLen === 2 ? buf.readUInt16LE(p) + 256 : fcsLen === 4 ? buf.readUInt32LE(p) : fcsLen === 8 ? Number(buf.readBigUInt64LE(p)) : undefined;
    p += fcsLen;
    for (let last = 0; !last; ) {
      if (p + 3 > buf.length) throw new Error("truncated zstd block");
      const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
      last = h & 1;
      p += 3 + (((h >> 1) & 3) === 1 ? 1 : h >>> 3);
    }
    if ((fhd >> 2) & 1) p += 4;
    if (p > buf.length) throw new Error("truncated zstd frame");
    const out = zstdDecompressSync(buf.subarray(start, p));
    if (fcs !== undefined && out.length !== fcs) throw new Error("zstd frame decoded to the wrong size");
    parts.push(out);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** A rollout's text, plain or compressed. */
function readRollout(p) {
  return p.endsWith(".zst") ? decodeZst(readFileSync(p)) : readFileSync(p, "utf8");
}

/**
 * Rollout files by plain name (X.jsonl for X.jsonl and X.jsonl.zst): the
 * plain file wins over a compressed one; otherwise sessions/ is walked first
 * and wins over archived_sessions/.
 */
function listRollouts() {
  const byName = new Map();
  for (const sub of ["sessions", "archived_sessions"]) {
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.startsWith("rollout-") && (e.name.endsWith(".jsonl") || e.name.endsWith(".jsonl.zst"))) {
          const name = e.name.replace(/\.zst$/, "");
          const kept = byName.get(name);
          if (!kept || (kept.endsWith(".zst") && !p.endsWith(".zst"))) byName.set(name, p);
        }
      }
    };
    walk(join(CODEX_HOME, sub));
  }
  return byName;
}

function readCodex() {
  const byName = listRollouts();
  const out = [];
  for (const [name, p] of byName) {
    const st = statSync(p);
    const f = readCodexFile(readRollout(p));
    out.push({ ...f, id: f.metaId ?? name.slice(0, -6), label: name.slice(8, 27), mtimeMs: st.mtimeMs, compressed: p.endsWith(".zst") });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// ---------------------------------------------------------------------------
// Cross-file ownership
// ---------------------------------------------------------------------------

/**
 * Each request belongs to the file that started first (then: ended first,
 * fewer requests, discovery order). Sets f.own (owned requests, largest value
 * per field across every copy), f.ownSelf (same requests, this file's values),
 * f.dropped, f.startedAt.
 */
function assignOwners(files) {
  const max = new Map();
  for (const f of files) {
    for (const r of f.requests) {
      if (!r.key) continue;
      const m = max.get(r.key);
      if (!m) max.set(r.key, Object.fromEntries(FIELDS.map((k) => [k, r[k]])));
      else for (const k of FIELDS) m[k] = Math.max(m[k], r[k]);
    }
  }
  const inf = (t) => (t === undefined ? Infinity : t);
  const order = files
    .map((f, i) => ({ f, i, s: inf(ms(f.start)), e: inf(ms(f.end)) }))
    .sort((a, b) => a.s - b.s || a.e - b.e || a.f.turnCount - b.f.turnCount || a.i - b.i);
  const seen = new Set();
  for (const { f } of order) {
    f.own = [];
    f.ownSelf = [];
    f.dropped = 0;
    for (const r of f.requests) {
      if (r.key) {
        if (seen.has(r.key)) {
          f.dropped++;
          continue;
        }
        seen.add(r.key);
        f.own.push({ ...r, ...max.get(r.key) });
      } else f.own.push(r);
      f.ownSelf.push(r);
    }
    // A file holding copies starts at its own first request.
    let start = f.start;
    let end = f.end;
    if (f.dropped) {
      let lo;
      let hi;
      for (const r of f.own) {
        const t = ms(r.ts);
        if (t === undefined) continue;
        if (lo === undefined || t < lo) [lo, start] = [t, r.ts];
        if (hi === undefined || t > hi) [hi, end] = [t, r.ts];
      }
    }
    f.startedAt = start ?? new Date(f.mtimeMs).toISOString();
    f.endedAt = end;
  }
}

function summarize(requests, table) {
  let tokens = 0;
  let output = 0;
  let usd = 0;
  let unpricedTokens = 0;
  let synthetic = 0;
  for (const r of requests) {
    if (r.model === "<synthetic>" || tokensOf(r) === 0) {
      if (r.model === "<synthetic>" && tokensOf(r) > 0) synthetic++;
      continue;
    }
    tokens += tokensOf(r);
    output += r.out;
    const c = requestCost(table, r);
    if (c === null) unpricedTokens += tokensOf(r);
    else usd += c;
  }
  return { tokens, output, usd, unpricedTokens, synthetic };
}

// ---------------------------------------------------------------------------
// Period views (same windows and day boundaries as the commands)
// ---------------------------------------------------------------------------

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Non-empty sessions with totals priced at `day`'s table. */
function sessionsAt(files, day) {
  const table = tableFor(day);
  return files.map((f) => ({ f, startedAt: f.startedAt, ...summarize(f.own, table) })).filter((s) => s.tokens > 0);
}

function todayView(files, now) {
  const all = sessionsAt(files, utcDay(now.getTime()));
  const today = localDay(now);
  const t = all.filter((s) => localDay(new Date(s.startedAt)) === today);
  const out = {
    sessionCount: t.length,
    totalTokens: t.reduce((a, s) => a + s.tokens, 0),
    totalSpendUSD: t.reduce((a, s) => a + s.usd, 0),
  };
  const earliest = Math.min(...all.map((s) => ms(s.startedAt)).filter((x) => x !== undefined));
  const days = Math.floor((now.getTime() - earliest) / DAY);
  const tier = [30, 14, 7, 3].find((n) => days >= n);
  if (all.length && tier) {
    const from = utcDay(now.getTime() - tier * DAY);
    const perDay = new Map();
    for (const s of all) {
      if (s.startedAt.slice(0, 10) < from) continue;
      const d = perDay.get(s.startedAt.slice(0, 10)) ?? { usd: 0, tokens: 0 };
      d.usd += s.usd;
      d.tokens += s.tokens;
      perDay.set(s.startedAt.slice(0, 10), d);
    }
    out.baselineDays = tier;
    out.medianTokensPerDay = median([...perDay.values()].map((d) => d.tokens));
    out.medianSpendPerDayUSD = median([...perDay.values()].map((d) => d.usd));
  }
  return out;
}

function forecastView(files, now) {
  const all = sessionsAt(files, utcDay(now.getTime()));
  const t = now.getTime();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remaining = lastDay - now.getDate();
  if (!all.length || remaining <= 1 || !all.some((s) => ms(s.startedAt) >= t - 14 * DAY)) return { status: "not-ok" };
  const earliest = Math.min(...all.map((s) => ms(s.startedAt)).filter((x) => x !== undefined));
  const days = Math.floor((t - earliest) / DAY);
  if (days < 7) return { status: "not-ok" };
  const windowDays = days >= 14 ? 14 : 7;
  const base = t - windowDays * DAY;
  const sampled = all.filter((s) => ms(s.startedAt) >= base);
  const buckets = new Array(windowDays).fill(0);
  for (const s of sampled) buckets[Math.min(windowDays - 1, Math.floor((ms(s.startedAt) - base) / DAY))] += s.usd;
  const avg = buckets.reduce((a, b) => a + b, 0) / windowDays;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const soFar = all.filter((s) => ms(s.startedAt) >= monthStart).reduce((a, s) => a + s.usd, 0);
  const lastMonth = all.filter((s) => ms(s.startedAt) >= lastMonthStart && ms(s.startedAt) < monthStart);
  return {
    status: "ok",
    windowDays,
    sessionsSampled: sampled.length,
    avgDailySpendUSD: avg,
    spendSoFarUSD: soFar,
    projectedSpendUSD: soFar + avg * remaining,
    lastMonthSpendUSD: lastMonth.length ? lastMonth.reduce((a, s) => a + s.usd, 0) : null,
  };
}

function trendView(files, now, sinceDays) {
  const until = utcDay(now.getTime());
  const since = utcDay(now.getTime() - sinceDays * DAY);
  const days = new Map();
  for (const s of sessionsAt(files, until)) {
    const d = s.startedAt.slice(0, 10);
    if (d < since || d > until) continue;
    const b = days.get(d) ?? { sessions: 0, output: 0, tokens: 0, usd: 0 };
    b.sessions++;
    b.output += s.output;
    b.tokens += s.tokens;
    b.usd += s.usd;
    days.set(d, b);
  }
  return { since, until, days };
}

function impactView(files, now, pivotDay) {
  const pivot = `${pivotDay}T00:00:00.000Z`;
  const before = { sessionCount: 0, totalTokens: 0, usd: 0 };
  const after = { sessionCount: 0, totalTokens: 0, usd: 0 };
  for (const s of sessionsAt(files, utcDay(now.getTime()))) {
    const b = s.startedAt < pivot ? before : after;
    b.sessionCount++;
    b.totalTokens += s.tokens;
    b.usd += s.usd;
  }
  return { before, after };
}

// ---------------------------------------------------------------------------
// Sipcode runs
// ---------------------------------------------------------------------------

// Temporary HOME (fresh usage cache) and cwd (receipts write there), made in main().
let sipHome;
let sipCwd;

export function sipcode(argv) {
  const before = new Date();
  let out;
  try {
    out = execFileSync(process.execPath, [CLI, ...argv], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
      cwd: sipCwd,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        HOME: sipHome,
        USERPROFILE: sipHome,
        SIPCODE_PROJECTS_DIR: CLAUDE_ROOT,
        CODEX_HOME,
        NO_COLOR: "1",
      },
    });
  } catch (err) {
    out = err.stdout ?? "";
  }
  const after = new Date();
  let json;
  try {
    json = JSON.parse(out);
  } catch {
    json = undefined;
  }
  return { json, before, after };
}

/** Compare a time-dependent view at the run's start and end instant; both must agree unless a boundary was crossed. */
function atRun(run, view) {
  const a = view(run.before);
  const b = view(run.after);
  return JSON.stringify(a) === JSON.stringify(b) ? [a] : [a, b];
}

const USD = 1e-6;

function compareAgent(agent, files, pass) {
  const tag = `[${agent} ${pass}]`;
  // stats --since all
  const st = sipcode(["stats", "--since", "all", "--json", "--agent", agent]);
  const all = sessionsAt(files, utcDay(st.before.getTime())).filter((s) => s.startedAt < st.before.toISOString());
  check(`${tag} stats sessions`, all.length, st.json?.sessionCount);
  check(
    `${tag} stats totalTokens`,
    all.reduce((a, s) => a + s.tokens, 0),
    st.json?.totals?.totalTokens,
  );
  const usd = all.reduce((a, s) => a + s.usd, 0);
  // --json rounds USD to 4 decimals: compare to that precision (stricter than the cent).
  check(`${tag} stats estCostUSD (4 dp)`, usd, st.json?.totals?.estCostUSD, 0.00005 + 1e-9);

  // today
  const td = sipcode(["today", "--json", "--agent", agent]);
  const tv = atRun(td, (now) => todayView(files, now));
  const tj = td.json ?? {};
  const pick = (f) => tv.find(f) ?? tv[0];
  const tMine = pick((v) => v.totalTokens === (tj.today?.totalTokens ?? 0));
  check(`${tag} today sessions`, tMine.sessionCount, tj.today?.sessionCount ?? 0);
  check(`${tag} today totalTokens`, tMine.totalTokens, tj.today?.totalTokens ?? 0);
  check(`${tag} today totalSpendUSD`, tMine.totalSpendUSD, tj.today?.totalSpendUSD ?? 0, USD);
  if (tj.baseline) {
    check(`${tag} today baseline days`, tMine.baselineDays, tj.baseline.windowDays);
    check(`${tag} today baseline medianTokensPerDay`, tMine.medianTokensPerDay, tj.baseline.medianTokensPerDay);
    check(
      `${tag} today baseline medianSpendPerDayUSD`,
      tMine.medianSpendPerDayUSD,
      tj.baseline.medianSpendPerDayUSD,
      USD,
    );
  } else {
    check(`${tag} today baseline present`, tMine.baselineDays !== undefined, false);
  }

  // forecast
  const fc = sipcode(["forecast", "--json", "--agent", agent]);
  const fv = atRun(fc, (now) => forecastView(files, now));
  const fj = fc.json ?? {};
  const fMine = fv.find((v) => v.sessionsSampled === fj.trajectoryInput?.sessionsSampled) ?? fv[0];
  check(`${tag} forecast status ok`, fMine.status === "ok", fj.status === "ok");
  if (fMine.status === "ok" && fj.status === "ok") {
    check(`${tag} forecast windowDays`, fMine.windowDays, fj.trajectoryInput.windowDays);
    check(`${tag} forecast sessionsSampled`, fMine.sessionsSampled, fj.trajectoryInput.sessionsSampled);
    check(`${tag} forecast avgDailySpendUSD`, fMine.avgDailySpendUSD, fj.trajectoryInput.avgDailySpendUSD, USD);
    check(`${tag} forecast spendSoFarUSD`, fMine.spendSoFarUSD, fj.monthEnd.spendSoFarUSD, USD);
    check(`${tag} forecast projectedSpendUSD`, fMine.projectedSpendUSD, fj.monthEnd.projectedSpendUSD, USD);
    check(
      `${tag} forecast lastMonthSpendUSD`,
      fMine.lastMonthSpendUSD ?? -1,
      fj.comparison?.lastMonthSpendUSD ?? -1,
      USD,
    );
  }

  // trend (30 days, UTC days): tokens and output per day, then cost per day
  for (const metric of ["output-ratio", "cost-per-session"]) {
    const tr = sipcode(["trend", "--since", "30d", "--metric", metric, "--json", "--agent", agent]);
    const views = atRun(tr, (now) => trendView(files, now, 30));
    const theirs = (tr.json?.days ?? []).filter((d) => d.sessions > 0);
    const mine = views.find((v) => v.since === tr.json?.window?.since) ?? views[0];
    let sessions = 0;
    let numer = 0;
    let denom = 0;
    let dayMismatch = 0;
    for (const d of theirs) {
      const m = mine.days.get(d.date) ?? { sessions: 0, output: 0, tokens: 0, usd: 0 };
      const mn = metric === "output-ratio" ? m.output : m.usd;
      const md = metric === "output-ratio" ? m.tokens : m.sessions;
      if (m.sessions !== d.sessions || Math.abs(mn - d.numerator) > USD || md !== d.denominator) dayMismatch++;
    }
    for (const m of mine.days.values()) {
      sessions += m.sessions;
      numer += metric === "output-ratio" ? m.output : m.usd;
      denom += metric === "output-ratio" ? m.tokens : m.sessions;
    }
    check(`${tag} trend ${metric} active days`, mine.days.size, theirs.length);
    check(`${tag} trend ${metric} days differing`, 0, dayMismatch);
    check(
      `${tag} trend ${metric} sessions`,
      sessions,
      theirs.reduce((a, d) => a + d.sessions, 0),
    );
    check(
      `${tag} trend ${metric} numerator sum`,
      numer,
      theirs.reduce((a, d) => a + d.numerator, 0),
      USD * 100,
    );
    check(
      `${tag} trend ${metric} denominator sum`,
      denom,
      theirs.reduce((a, d) => a + d.denominator, 0),
      USD,
    );
  }

  // impact with an explicit pivot (no install marker needed)
  const starts = files
    .filter((f) => summarize(f.own, tableFor("9999-12-31")).tokens > 0)
    .map((f) => f.startedAt)
    .sort();
  const pivotDay = starts.length ? starts[Math.floor(starts.length / 2)].slice(0, 10) : "2026-01-01";
  const im = sipcode(["impact", "--since", pivotDay, "--json", "--agent", agent]);
  const iv = impactView(files, im.before, pivotDay);
  for (const side of ["before", "after"]) {
    check(`${tag} impact ${side} sessions`, iv[side].sessionCount, im.json?.[side]?.sessionCount);
    check(`${tag} impact ${side} totalTokens`, iv[side].totalTokens, im.json?.[side]?.totalTokens);
    // impact rounds USD to the cent.
    check(`${tag} impact ${side} estCostUSD (to the cent)`, iv[side].usd, im.json?.[side]?.estCostUSD, 0.005 + 1e-9);
  }
}

// ---------------------------------------------------------------------------
// Single-session checks: short ids, why / receipt own requests
// ---------------------------------------------------------------------------

function shortId(id, agent) {
  if (agent === "codex" && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}(?:-|$)/i.test(id)) return id.slice(0, 18);
  return id.slice(0, 8);
}

function sessionChecks(agent, files) {
  const tag = `[${agent}]`;
  let ambiguous = 0;
  for (const f of files) {
    const s = shortId(f.id, agent);
    if (files.filter((g) => g.id.startsWith(s)).length !== 1) ambiguous++;
  }
  check(`${tag} short ids that match more than one session (of ${files.length})`, 0, ambiguous);

  const live = files
    .filter((f) => summarize(f.own, tableFor("9999-12-31")).tokens > 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const step = Math.max(1, Math.floor(live.length / WHY_SAMPLES));
  const sample = new Set(live.filter((_, i) => i % step === 0).slice(0, WHY_SAMPLES));
  const resumed = live.filter((f) => f.dropped > 0);
  for (const f of resumed) sample.add(f);
  console.log(`${tag} why sample: ${sample.size} sessions (${resumed.length} hold copied requests)`);
  let ownVsMaxDiffer = 0;
  for (const f of sample) {
    const s = shortId(f.id, agent);
    const w = sipcode(["why", "--session", s, "--agent", agent, "--json"]).json;
    const own = summarize(f.ownSelf, tableFor(f.startedAt.slice(0, 10)));
    const maxed = summarize(f.own, tableFor(f.startedAt.slice(0, 10)));
    if (own.tokens !== maxed.tokens) ownVsMaxDiffer++;
    const label = `${tag} why ${f.dropped > 0 ? "resumed " : ""}session (${f.own.length} own requests, ${f.dropped} copied)`;
    check(`${label} id resolves`, s, w?.header?.sessionIdShort);
    check(`${label} totalTokens`, own.tokens, w?.punchline?.totalTokens);
    check(`${label} estCostUSD`, own.usd, w?.totals?.estCostUSD, USD);
    if (f.dropped > 0) {
      const r = sipcode(["receipt", s, "--agent", agent, "--json", "--html-only", "--no-share"]).json;
      // The hero is the session's tokens, or (post-install receipt) the estimated savings why reports.
      if (r?.variant === "post-install")
        check(`${label} receipt (post-install) savings vs why`, w?.estimatedSavings?.totalTokens, r?.hero?.tokens);
      else check(`${label} receipt tokens`, own.tokens, r?.hero?.tokens);
    }
  }
  console.log(`${tag} sampled sessions whose own-file values differ from the max across copies: ${ownVsMaxDiffer}`);
}

// ---------------------------------------------------------------------------
// Codex limits
// ---------------------------------------------------------------------------

const MIN = 60_000;
const AUTO_REVIEW = "codex-auto-review";
const EPS = 1e-9;

/** Every limit reading in the Codex logs, in reading order. */
function limitReadings() {
  const out = [];
  let malformed = 0;
  for (const p of listRollouts().values()) {
    for (const raw of readRollout(p).split(/\r?\n/)) {
      if (!raw.includes('"rate_limits"')) continue;
      let e;
      try {
        e = JSON.parse(raw);
      } catch {
        malformed++;
        continue;
      }
      if (!e || typeof e !== "object" || Array.isArray(e)) {
        malformed++;
        continue;
      }
      if (e.type !== "event_msg" || e.payload?.type !== "token_count") continue;
      const rl = e.payload.rate_limits;
      if (rl === null || rl === undefined) continue;
      const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
      if (typeof rl !== "object" || Array.isArray(rl) || !Number.isFinite(at)) {
        malformed++;
        continue;
      }
      for (const slot of ["primary", "secondary"]) {
        const w = rl[slot];
        if (w === null || w === undefined) continue;
        const obj = typeof w === "object" && !Array.isArray(w);
        const ok = obj && [w.used_percent, w.window_minutes, w.resets_at].every((x) => typeof x === "number" && Number.isFinite(x));
        if (!ok || w.used_percent < 0 || w.window_minutes <= 0 || w.resets_at <= 0) {
          malformed++;
          continue;
        }
        out.push({
          at,
          limitId: (typeof rl.limit_id === "string" && rl.limit_id) || "codex",
          plan: (typeof rl.plan_type === "string" && rl.plan_type) || null,
          wm: w.window_minutes,
          pct: w.used_percent,
          resetsAt: w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1000,
        });
      }
    }
  }
  out.sort((a, b) => a.at - b.at || a.resetsAt - b.resetsAt || a.pct - b.pct);
  return { readings: out, malformed };
}

/** Windows (key "limitId|minutes") with their periods: reset time, max, first and newest time, rises, start. */
function limitWindows(readings) {
  const windows = new Map();
  for (const r of readings) {
    if (r.at > r.resetsAt) continue; // stale: logged after its own reset time
    const key = `${r.limitId}|${r.wm}`;
    let w = windows.get(key);
    if (!w) windows.set(key, (w = { limitId: r.limitId, wm: r.wm, periods: [] }));
    const cur = w.periods.at(-1);
    if (cur && cur.resetsAt - r.resetsAt > 15 * MIN) continue; // stale: an earlier reset time than the open period's
    const shift = cur ? r.resetsAt - cur.resetsAt : 0;
    if (
      !cur ||
      Math.abs(shift) > Math.max(15 * MIN, r.wm * MIN * 0.01) || // beyond drift: a new reset time
      r.at > cur.resetsAt || // past the period's reset time
      (shift > 15 * MIN && r.pct < cur.max) // early reset
    ) {
      w.periods.push({ resetsAt: r.resetsAt, max: r.pct, first: r.at, newest: r.at, plan: r.plan, rises: r.pct > 0 ? [{ at: r.at, rise: r.pct }] : [] });
      continue;
    }
    if (r.pct > cur.max) {
      cur.rises.push({ at: r.at, rise: r.pct - cur.max });
      cur.max = r.pct;
    }
    cur.resetsAt = r.resetsAt;
    cur.newest = r.at;
    cur.plan = r.plan;
  }
  for (const w of windows.values())
    w.periods.forEach((p, i) => {
      p.start = Math.max(Math.min(p.resetsAt - w.wm * MIN, p.first), i > 0 ? w.periods[i - 1].newest : -Infinity);
    });
  return windows;
}

const inPeriod = (p, requests) =>
  requests.filter((r) => r.at > p.start && r.at <= p.newest).sort((a, b) => a.at - b.at);

/** Per line of "what used it" (session id, or codex-auto-review): percent and tokens; plus unattributed. */
function attributeLimit(p, requests) {
  const rs = inPeriod(p, requests);
  const lines = new Map();
  const line = (r) => {
    const key = r.model === AUTO_REVIEW ? AUTO_REVIEW : r.session;
    let l = lines.get(key);
    if (!l) lines.set(key, (l = { percent: 0, tokens: 0 }));
    return l;
  };
  for (const r of rs) line(r).tokens += r.tokens;
  let unattributed = 0;
  let k = 0;
  for (const { at, rise } of p.rises) {
    const group = [];
    while (k < rs.length && rs[k].at <= at) group.push(rs[k++]);
    const t = group.reduce((a, r) => a + r.tokens, 0);
    if (t === 0) {
      unattributed += rise;
      continue;
    }
    for (const r of group) line(r).percent += (rise * r.tokens) / t;
  }
  if (lines.get(AUTO_REVIEW)?.percent === 0) lines.delete(AUTO_REVIEW);
  return { lines, unattributed };
}

/** Comparable periods (tokens per 1%) and the first possible cut. */
function shrinkLimit(w, requests, asOf) {
  const points = [];
  const last = w.periods.at(-1);
  for (const p of w.periods) {
    const finished = p !== last || p.resetsAt < asOf;
    if (!finished || p.max < 20) continue;
    const rs = inPeriod(p, requests);
    const total = rs.reduce((a, r) => a + r.tokens, 0);
    const byModel = new Map();
    for (const r of rs) if (r.model !== undefined) byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.tokens);
    let top;
    for (const [m, t] of byModel) if (!top || t > top[1]) top = [m, t];
    if (!top || total === 0 || top[1] / total < 0.9) continue;
    points.push({ model: top[0], start: p.start, raw: total / p.max, share: top[1] / total });
  }
  let cut = null;
  for (let i = 0; i < points.length && !cut; i++) {
    const earlier = points.slice(0, i).filter((q) => q.model === points[i].model).map((q) => q.raw);
    if (earlier.length < 2) continue;
    const base = median(earlier);
    if (points[i].raw <= base / 2)
      cut = { at: new Date(points[i].start).toISOString().slice(0, 10), factor: Math.round((base / points[i].raw) * 10) / 10 };
  }
  return { points, cut };
}

function limitsChecks(codexFiles, pass) {
  const tag = `[codex limits ${pass}]`;
  const { readings, malformed } = limitReadings();
  const run = sipcode(["limits", "--json", "--since", "all"]);
  const j = run.json;
  console.log(`${tag} ${readings.length} readings, ${malformed} unreadable`);
  const windows = limitWindows(readings);
  if (windows.size === 0) {
    // No readings, or every one stale: Sipcode prints no windows and no "as of".
    check(`${tag} windows (no usable readings)`, 0, j?.windows?.length ?? -1);
    check(`${tag} as of (no usable readings)`, null, j?.asOf);
    return;
  }
  const newest = readings.at(-1);
  const asOf = newest.at;
  check(`${tag} as of`, new Date(asOf).toISOString(), j?.asOf);
  check(`${tag} plan`, newest.plan, j?.planType);
  check(`${tag} windows`, windows.size, j?.windows?.length);
  const requests = codexFiles
    .flatMap((f) => f.own.map((r) => ({ at: ms(r.ts), tokens: tokensOf(r), model: r.model, session: f.id })))
    .filter((r) => r.at !== undefined && r.tokens > 0);
  let mixed = 0;
  let unbalanced = 0;
  let periodsTotal = 0;
  for (const w of windows.values()) {
    const label = `${tag} ${w.limitId} ${w.wm}-minute window`;
    const theirs = j?.windows?.find((x) => x.limitId === w.limitId && x.windowMinutes === w.wm);
    const cur = w.periods.at(-1);
    check(`${label} periods`, w.periods.length, theirs?.periodCount);
    check(`${label} newest percent`, cur.max, theirs?.usedPercent);
    check(`${label} resets at`, new Date(cur.resetsAt).toISOString(), theirs?.resetsAt);

    // Every period (independent): attributed + unattributed = its observed rise.
    for (const p of w.periods) {
      const a = attributeLimit(p, requests);
      const sum = [...a.lines.values()].reduce((s, l) => s + l.percent, 0) + a.unattributed;
      if (Math.abs(sum - p.max) > EPS) unbalanced++;
      periodsTotal++;
    }

    // What used the newest period: attributed + unattributed = observed rise, line by line equal.
    const a = attributeLimit(cur, requests);
    const usedBy = theirs?.usedBy ?? [];
    const mine = [...a.lines.values()].reduce((s, l) => s + l.percent, 0) + a.unattributed;
    const sip = usedBy.reduce((s, u) => s + u.percent, 0) + (theirs?.unattributedPercent ?? NaN);
    check(`${label} attributed + unattributed = observed rise (independent)`, cur.max, mine, EPS);
    check(`${label} attributed + unattributed = observed rise (sipcode)`, cur.max, sip, EPS);
    check(`${label} unattributed percent`, a.unattributed, theirs?.unattributedPercent, EPS);
    check(`${label} what-used lines`, a.lines.size, usedBy.length);
    let differing = 0;
    for (const [key, l] of a.lines) {
      const u = usedBy.find((x) => x.sessionId === key);
      if (!u || Math.abs(u.percent - l.percent) > EPS || u.tokens !== l.tokens) differing++;
    }
    check(`${label} what-used lines differing`, 0, differing);

    // Tokens per 1% and the possible cut.
    const s = shrinkLimit(w, requests, asOf);
    const tpp = theirs?.tokensPerPercent ?? [];
    check(`${label} tokens-per-1% periods`, s.points.length, tpp.length);
    differing = 0;
    s.points.forEach((p, i) => {
      const t = tpp[i];
      if (!t || t.model !== p.model || t.periodStart !== new Date(p.start).toISOString() || t.tokensPerPercent !== Math.round(p.raw))
        differing++;
    });
    check(`${label} tokens-per-1% periods differing`, 0, differing);
    check(`${label} possible cut`, JSON.stringify(s.cut), JSON.stringify(theirs?.possibleCut ?? null));
    // Mixed-model periods are never compared: every period Sipcode lists has 90%+ of its tokens from its model.
    for (const t of tpp) {
      const p = s.points.find((x) => new Date(x.start).toISOString() === t.periodStart);
      if (!p || p.model !== t.model || p.share < 0.9) mixed++;
    }
    if (s.cut) console.log(`${label}: possible cut around ${s.cut.at} (${s.cut.factor}x)`);
  }
  check(`${tag} periods whose attributed + unattributed differs from the rise (of ${periodsTotal}, independent)`, 0, unbalanced);
  check(`${tag} periods compared with mixed models`, 0, mixed);
}

// ---------------------------------------------------------------------------
// Regress (`regress --json`)
// ---------------------------------------------------------------------------

const REGRESS_MIN_N = 20;
const KNOWN_REGRESSIONS = [
  { id: "R1", checks: ["uncached-input"], from: "2.1.257", to: "2.1.259" },
  { id: "R2", checks: ["warm-cache-miss"], from: "2.1.69", to: "2.1.89" },
  { id: "R3", checks: ["post-idle-cold", "warm-cache-miss"], from: "2.1.85", to: "2.1.100" },
  { id: "R4", checks: ["ttl-5m"], from: "2.1.0", to: "2.1.128" },
  { id: "R5", checks: ["hourly-rebuild"], from: "2.1.0", to: "2.1.247" },
];
const vparts = (v) => {
  const p = (v || "0.0.0").split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  while (p.length < 3) p.push(0);
  return p;
};
const vcmp = (a, b) => {
  const x = vparts(a);
  const y = vparts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
const upperMedian = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);

/** Claude Code rows per file: requests with usage, a version and a real model, in time order (the owner's copy, largest usage). */
function regressClaudeFiles(files) {
  return files
    .map((f) =>
      f.own
        .filter((r) => (r.hasUsage || tokensOf(r) > 0) && r.version && r.model !== "<synthetic>")
        .map((r) => ({
          version: r.version,
          model: r.model ?? "?",
          automated: r.side || r.entry.startsWith("sdk"),
          ts: ms(r.ts) ?? 0,
          inp: r.inp,
          cr: r.cr,
          cw: r.cw,
          c1: r.cw1h,
          c5: r.split ? Math.max(0, r.cw - r.cw1h) : 0,
          ctx: r.inp + r.cr + r.cw,
          afterTool: r.afterTool,
        }))
        .sort((a, b) => a.ts - b.ts),
    )
    .filter((rows) => rows.length > 0);
}

/** Per-version rate table: versions with >= minN samples; baseline = every other sample. */
function rates(samples, minN) {
  const by = new Map();
  for (const s of samples) by.set(s.version, [...(by.get(s.version) ?? []), s]);
  const hits = samples.filter((s) => s.value).length;
  return [...by.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .filter(([, a]) => a.length >= minN)
    .map(([version, a]) => {
      const h = a.filter((s) => s.value).length;
      const restN = samples.length - a.length;
      return { version, n: a.length, rate: h / a.length, baseline: restN ? (hits - h) / restN : 0, baselineN: restN };
    });
}

/** Flagged versions adjacent in `order` → [from, to] ranges. */
function ranges(flagged, order) {
  const out = [];
  for (const v of [...flagged].sort(vcmp)) {
    const last = out.at(-1);
    if (last && order.indexOf(v) >= 0 && order.indexOf(v) === order.indexOf(last[1]) + 1) last[1] = v;
    else out.push([v, v]);
  }
  return out;
}

function regressClaude(files) {
  const main = files.map((rows) => rows.filter((r) => !r.automated)).filter((rows) => rows.length);
  const min = 60_000;
  const findings = [];
  const warm = [];
  const idle = [];
  for (const rows of main) {
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1];
      const r = rows[i];
      const gap = (r.ts - p.ts) / min;
      if (gap >= 0 && gap <= 5 && r.ctx >= 30e3 && r.ctx >= 0.6 * p.ctx) warm.push({ version: r.version, value: r.cr < 0.3 * r.ctx });
    }
    for (let i = 1; i + 2 < rows.length; i++) {
      if ((rows[i].ts - rows[i - 1].ts) / min < 60) continue;
      const a = rows[i + 1];
      const b = rows[i + 2];
      if ((a.ts - rows[i].ts) / min > 5 || (b.ts - a.ts) / min > 5 || a.ctx < 30e3 || b.ctx < 30e3) continue;
      idle.push({ version: rows[i].version, value: a.cr < 0.3 * a.ctx && b.cr < 0.3 * b.ctx });
    }
  }
  const warmT = rates(warm, REGRESS_MIN_N);
  const idleT = rates(idle, Math.max(5, REGRESS_MIN_N >> 2));
  for (const [id, t, minRate, floor] of [
    ["warm-cache-miss", warmT, 0.25, 0.01],
    ["post-idle-cold", idleT, 0.5, 0.02],
  ]) {
    const bad = t.filter((x) => x.rate >= minRate && x.rate >= 3 * Math.max(x.baseline, floor)).map((x) => x.version);
    for (const [from, to] of ranges(bad, t.map((x) => x.version))) findings.push({ id, from, to });
  }

  const ttl = new Map();
  for (const rows of main)
    for (const r of rows) {
      if (r.c5 + r.c1 === 0) continue;
      const t = ttl.get(r.version) ?? { c5: 0, c1: 0, n: 0 };
      t.c5 += r.c5;
      t.c1 += r.c1;
      t.n++;
      ttl.set(r.version, t);
    }
  const ttlBase = [...ttl.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .filter(([, t]) => t.n >= REGRESS_MIN_N)
    .map(([version, t]) => ({ version, n: t.n, share5m: t.c5 / (t.c5 + t.c1) }));
  const all5 = ttlBase.reduce((a, r) => a + r.share5m * r.n, 0);
  const allN = ttlBase.reduce((a, r) => a + r.n, 0);
  const ttlT = ttlBase.map((r) => ({ ...r, baseline: allN - r.n ? (all5 - r.share5m * r.n) / (allN - r.n) : 0 }));
  const ttlBad = ttlT.filter((r) => r.share5m >= 0.5 && r.baseline <= 0.2 && allN - r.n >= REGRESS_MIN_N).map((r) => r.version);
  for (const [from, to] of ranges(ttlBad, ttlT.map((r) => r.version))) findings.push({ id: "ttl-5m", from, to });

  const unc = new Map();
  for (const rows of main)
    for (const r of rows) {
      if (!r.afterTool || r.ctx < 20e3) continue;
      const k = `${r.model}\u0000${r.version}`;
      unc.set(k, [...(unc.get(k) ?? []), r]);
    }
  const groups = [...unc.values()]
    .filter((a) => a.length >= Math.max(5, REGRESS_MIN_N >> 2))
    .map((a) => ({ model: a[0].model, version: a[0].version, n: a.length, median: upperMedian(a.map((r) => r.inp)) }));
  const uncT = groups.map((g) => {
    const others = groups.filter((o) => o.model === g.model && o.version !== g.version);
    return { ...g, baseline: others.length ? upperMedian(others.map((o) => o.median)) : null };
  });
  const uncBad = uncT.filter((r) => r.median >= 500 && (r.baseline === null || r.baseline < 100)).map((r) => r.version);
  for (const [from, to] of ranges(uncBad, [...new Set(uncT.map((r) => r.version))].sort(vcmp)))
    findings.push({ id: "uncached-input", from, to });

  const hb = new Map();
  for (const rows of main) {
    let last = null;
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1];
      const r = rows[i];
      if ((r.ts - p.ts) / min > 5 || p.ctx < 50e3 || r.ctx < 0.6 * p.ctx || r.cr >= 0.2 * p.ctx) continue;
      const g = hb.get(r.version) ?? [];
      if (last !== null) g.push((r.ts - last) / min);
      last = r.ts;
      hb.set(r.version, g);
    }
  }
  const hbT = [...hb.entries()]
    .sort((a, b) => vcmp(a[0], b[0]))
    .map(([version, iv]) => ({ version, n: iv.length, hourly: iv.filter((x) => x >= 50 && x <= 70).length }));
  const hbBad = hbT.filter((r) => r.n >= 4 && r.hourly / r.n >= 0.5).map((r) => r.version);
  for (const [from, to] of ranges(hbBad, hbT.map((r) => r.version))) findings.push({ id: "hourly-rebuild", from, to });

  const all = files.flat();
  const rows = all.filter((r) => !r.automated);
  const versions = [...new Set(rows.map((r) => r.version))].sort(vcmp);
  const ts = rows.map((r) => r.ts).filter((t) => t > 0).sort((a, b) => a - b);
  const coverage = {
    requests: rows.length,
    excludedAutomated: all.length - rows.length,
    sessions: files.filter((f) => f.some((r) => !r.automated)).length,
    versions: versions.length,
    firstVersion: versions[0] ?? null,
    lastVersion: versions.at(-1) ?? null,
    from: ts.length ? new Date(ts[0]).toISOString().slice(0, 10) : null,
    to: ts.length ? new Date(ts.at(-1)).toISOString().slice(0, 10) : null,
    knownWindowsCovered: KNOWN_REGRESSIONS.filter((k) => versions.some((v) => vcmp(v, k.from) >= 0 && vcmp(v, k.to) <= 0)).map((k) => k.id),
  };
  return { coverage, findings, tables: { warmCacheMiss: warmT, postIdleCold: idleT, ttl5m: ttlT, uncachedInput: uncT, hourlyRebuild: hbT } };
}

/** Codex: per version / model / plan / window, the percent its requests were charged (rise by rise, by tokens) per 1M uncached + output tokens. */
function regressCodex(codexFiles, readings) {
  const requests = codexFiles
    .flatMap((f) =>
      f.own.map((r) => ({
        at: ms(r.ts),
        tokens: tokensOf(r),
        work: r.inp + r.cw + r.out,
        model: r.model ?? "?",
        version: (f.cliVersion ?? "?").replace(/-.*/, ""),
      })),
    )
    .filter((r) => r.at !== undefined && r.tokens > 0);
  const groups = new Map();
  for (const w of limitWindows(readings).values()) {
    for (const p of w.periods) {
      const rs = inPeriod(p, requests);
      let k = 0;
      for (const { at, rise } of p.rises) {
        const group = [];
        while (k < rs.length && rs[k].at <= at) group.push(rs[k++]);
        const t = group.reduce((a, r) => a + r.tokens, 0);
        if (t === 0) continue;
        for (const r of group) {
          const key = [r.version, r.model, p.plan ?? "?", w.limitId, w.wm].join("|");
          const g = groups.get(key) ?? { version: r.version, model: r.model, plan: p.plan ?? "?", limitId: w.limitId, windowMinutes: w.wm, requests: 0, percent: 0, workTokens: 0 };
          g.requests++;
          g.percent += (rise * r.tokens) / t;
          g.workTokens += r.work;
          groups.set(key, g);
        }
      }
    }
  }
  const table = [...groups.values()]
    .filter((g) => g.workTokens >= 200_000)
    .map((g) => ({ ...g, percentPerMillion: g.percent / (g.workTokens / 1e6) }))
    .sort((a, b) => vcmp(a.version, b.version) || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) || a.windowMinutes - b.windowMinutes || (a.limitId < b.limitId ? -1 : 1));
  const findings = [];
  for (const r of table) {
    const peers = table.filter((o) => o !== r && o.plan === r.plan && o.limitId === r.limitId && o.windowMinutes === r.windowMinutes);
    if (!peers.length) continue;
    const base = upperMedian(peers.map((o) => o.percentPerMillion));
    if (base > 0 && r.percentPerMillion >= 2 * base) findings.push({ id: "codex-limit-burn", from: r.version, to: r.version });
  }
  const versions = [...new Set(requests.map((r) => r.version))].sort(vcmp);
  return { requests: requests.length, versions: versions.length, table, findings };
}

function regressChecks(claudeFiles, codexFiles, pass) {
  const tag = `[regress ${pass}]`;
  const j = sipcode(["regress", "--json"]).json;
  const c = regressClaude(regressClaudeFiles(claudeFiles));
  const sipCov = j?.coverage?.claudeCode ?? {};
  for (const k of Object.keys(c.coverage)) {
    check(`${tag} claude-code coverage ${k}`, JSON.stringify(c.coverage[k]), JSON.stringify(sipCov[k]));
  }
  // Rows compared in (version, model) order: table order is not part of the result.
  const byKey = (a, b) => vcmp(a.version, b.version) || String(a.model ?? "").localeCompare(String(b.model ?? ""));
  for (const [name, rows] of Object.entries(c.tables)) {
    const mine = [...rows].sort(byKey);
    const theirs = [...(j?.checks?.claudeCode?.[name] ?? [])].sort(byKey);
    check(`${tag} ${name} rows`, mine.length, theirs.length);
    let differing = 0;
    mine.forEach((m, i) => {
      const t = theirs[i];
      if (!t) return differing++;
      for (const [k, v] of Object.entries(m)) {
        const ok = typeof v === "number" ? Math.abs(v - t[k]) <= EPS : v === t[k];
        if (!ok) return differing++;
      }
    });
    check(`${tag} ${name} rows differing`, 0, differing);
  }
  const { readings } = limitReadings();
  const x = regressCodex(codexFiles, readings);
  check(`${tag} codex requests`, x.requests, j?.coverage?.codex?.requests);
  check(`${tag} codex versions`, x.versions, j?.coverage?.codex?.versions);
  const theirs = j?.checks?.codex ?? [];
  check(`${tag} codex groups`, x.table.length, theirs.length);
  let differing = 0;
  x.table.forEach((m, i) => {
    const t = theirs[i];
    if (!t) return differing++;
    for (const k of ["version", "model", "plan", "limitId", "windowMinutes", "requests", "workTokens"]) if (m[k] !== t[k]) return differing++;
    for (const k of ["percent", "percentPerMillion"]) if (Math.abs(m[k] - t[k]) > 1e-6) return differing++;
  });
  check(`${tag} codex groups differing`, 0, differing);
  const mineF = [...c.findings, ...x.findings].map((f) => `${f.id} ${f.from} ${f.to}`).sort();
  const sipF = (j?.findings ?? []).map((f) => `${f.id} ${f.from} ${f.to}`).sort();
  check(`${tag} findings`, JSON.stringify(mineF), JSON.stringify(sipF));
  check(`${tag} nothing read`, c.coverage.requests === 0 && x.requests === 0, j?.access?.nothingRead);
  console.log(`${tag} ${c.coverage.requests} interactive requests, ${c.coverage.excludedAutomated} automated left out, ${x.table.length} Codex groups, ${mineF.length} finding(s)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export { readClaude, readCodex, readCodexFile, assignOwners, summarize, tableFor, utcDay };

function main() {
  sipHome = mkdtempSync(join(tmpdir(), "sipcode-verify-home-"));
  sipCwd = mkdtempSync(join(tmpdir(), "sipcode-verify-cwd-"));
  const t0 = Date.now();
  const claude = readClaude();
  assignOwners(claude);
  const codex = readCodex();
  assignOwners(codex);
  console.log(`read logs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  for (const [agent, files] of [
    ["claude-code", claude],
    ["codex", codex],
  ]) {
    const s = summarize(
      files.flatMap((f) => f.own),
      tableFor(utcDay(Date.now())),
    );
    const requests = files.reduce(
      (a, f) => a + f.own.filter((r) => tokensOf(r) > 0 && r.model !== "<synthetic>").length,
      0,
    );
    const dropped = files.reduce((a, f) => a + f.dropped, 0);
    console.log(
      `${agent}: ${files.length} files, ${files.filter((f) => summarize(f.own, tableFor("9999-12-31")).tokens > 0).length} non-empty sessions, ` +
        `${requests} requests, ${s.tokens.toLocaleString("en-US")} tokens, $${s.usd.toFixed(2)}, ` +
        `${dropped} copied requests dropped, ${files.filter((f) => f.dropped > 0).length} files hold copies, ` +
        `${s.unpricedTokens.toLocaleString("en-US")} unpriced tokens, ${s.synthetic} synthetic requests with usage`,
    );
  }
  console.log(`codex: ${codex.filter((f) => f.compressed).length} of ${codex.length} rollout files compressed (.jsonl.zst)`);

  // Codex ground truth: per file, the counted tokens equal Codex's own final cumulative total.
  codex
    .slice()
    .sort((a, b) => (a.label < b.label ? -1 : 1))
    .forEach((f, i) => {
      const mine = f.requests.reduce((a, r) => a + r.raw.total, 0);
      const inOut = f.requests.reduce((a, r) => a + r.raw.input + r.raw.output, 0);
      const kind = `${f.records ? "records" : "token_count"}${f.isSubagent ? ", subagent" : ""}`;
      if (f.resets) {
        console.log(
          `SKIP     codex file #${i + 1} ${f.label} (${kind}): ${f.resets} counter reset(s), no single final total`,
        );
        return;
      }
      check(`codex file #${i + 1} ${f.label} (${kind})`, mine, f.groundTruth ?? 0, 0, "Codex final total");
      if (inOut !== mine) check(`codex file #${i + 1} input+output vs total_tokens`, inOut, mine, 0, "total_tokens");
      if (f.negativeFields)
        console.log(`note: codex file #${i + 1} has ${f.negativeFields} cumulative field(s) that went down`);
    });
  const subs = codex.filter((f) => f.isSubagent);
  console.log(
    `codex subagent threads: ${subs.length} files, ${subs.reduce((a, f) => a + summarize(f.own, tableFor("9999-12-31")).tokens, 0).toLocaleString("en-US")} tokens (counted in every period total above)`,
  );

  if (!existsSync(CLI)) {
    console.log("dist/cli.js not found: run `npm run build` first");
    process.exit(1);
  }
  try {
    for (const pass of ["cold cache", "warm cache"]) {
      for (const [agent, files] of [
        ["claude-code", claude],
        ["codex", codex],
      ])
        compareAgent(agent, files, pass);
      limitsChecks(codex, pass);
      regressChecks(claude, codex, pass);
    }
    sessionChecks("claude-code", claude);
    sessionChecks("codex", codex);
  } finally {
    rmSync(sipHome, { recursive: true, force: true });
    rmSync(sipCwd, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} mismatch(es)` : "all checks match");
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
