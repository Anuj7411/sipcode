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
    if (e.type !== "assistant") continue;
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
    const prev = key ? byKey.get(key) : undefined;
    if (prev) {
      for (const f of FIELDS) prev[f] = Math.max(prev[f], v[f]);
      continue;
    }
    const r = { key, model: typeof m.model === "string" ? m.model : undefined, ts, ...v };
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

function readCodex() {
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
        else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl") && !byName.has(e.name))
          byName.set(e.name, p);
      }
    };
    walk(join(CODEX_HOME, sub));
  }
  const out = [];
  for (const [name, p] of byName) {
    const st = statSync(p);
    const f = readCodexFile(readFileSync(p, "utf8"));
    out.push({ ...f, id: f.metaId ?? name.slice(0, -6), label: name.slice(8, 27), mtimeMs: st.mtimeMs });
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
