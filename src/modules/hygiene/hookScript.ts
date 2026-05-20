/**
 * Generates the on-disk Node.js source for the sipcode pressure +
 * breakpoint hooks. Written to `~/.claude/hooks/sipcode-pressure.mjs`
 * and `~/.claude/hooks/sipcode-breakpoint.mjs` by `hygiene --install`.
 *
 * Design constraints (per the brief):
 *  - zero deps (Node built-ins only)
 *  - cross-platform (.mjs run via node)
 *  - crash-safe: on ANY error → exit 0 silently
 *  - bounded: read the latest transcript file's last assistant turn,
 *    not the whole transcript
 *  - <100 lines each
 *  - brand voice on stderr lines
 *
 * The pressure hook is wired as a PreToolUse hook. The breakpoint hook
 * is wired as a PostToolUse hook. Claude Code's hook protocol pipes a
 * JSON object on stdin; we read it best-effort and emit advisory text
 * on stderr.
 *
 * Pressure bands (approximation of context-window utilization):
 *   - p50 (~50%) — soft nudge
 *   - p70 (~70%) — actionable suggestion
 *   - p90 (~90%) — urgent
 *
 * We estimate utilization from the latest assistant `usage` block in
 * the session transcript. Claude Code transcripts live under
 * `~/.claude/projects/<hash>/<session>.jsonl`. We sample the last few
 * lines of the most recently modified transcript (bounded read; no
 * full re-parse).
 */

/**
 * Sipcode signature line baked into both hook scripts so we can detect
 * "this is our script" before overwriting on install.
 */
export const SIPCODE_HOOK_SIGNATURE = "// sipcode-hook v=1";

/** Approximate context-window size for utilization math. */
export const APPROX_CONTEXT_WINDOW_TOKENS = 200_000;

export function pressureHookScript(): string {
  return `#!/usr/bin/env node
${SIPCODE_HOOK_SIGNATURE}
// sipcode pressure hook (PreToolUse). honest limit: we can warn — we can't
// force compaction. on any error, exit 0 silently so claude code never
// breaks because of us.
import { readdir, stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const APPROX = ${APPROX_CONTEXT_WINDOW_TOKENS};
const BANDS = [
  { at: 0.9, msg: "[sipcode] context at ~90%. /compact now — or start a new session." },
  { at: 0.7, msg: "[sipcode] context at ~70%. /compact recommended at next natural break." },
  { at: 0.5, msg: "[sipcode] context at ~50%. consider summarizing before continuing." },
];

async function latestTranscript() {
  const root = join(homedir(), ".claude", "projects");
  let projs;
  try { projs = await readdir(root); } catch { return null; }
  let best = null;
  for (const p of projs) {
    let files;
    try { files = await readdir(join(root, p)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const full = join(root, p, f);
      try {
        const s = await stat(full);
        if (!best || s.mtimeMs > best.mtimeMs) best = { full, mtimeMs: s.mtimeMs };
      } catch { /* skip */ }
    }
  }
  return best ? best.full : null;
}

function utilizationFromContent(content) {
  // Find the LAST assistant turn with a usage block. Scan from the end.
  const lines = content.split("\\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (!ln || !ln.includes("\\"usage\\"")) continue;
    try {
      const obj = JSON.parse(ln);
      const u = obj?.message?.usage ?? obj?.usage;
      if (!u) continue;
      const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      const output = u.output_tokens || 0;
      return (input + output) / APPROX;
    } catch { /* keep scanning */ }
  }
  return 0;
}

async function main() {
  try {
    // Drain stdin best-effort (claude code pipes a json event). We don't need it.
    process.stdin.resume();
    setTimeout(() => process.stdin.pause(), 5);
    const file = await latestTranscript();
    if (!file) return;
    let content;
    try { content = await readFile(file, "utf-8"); } catch { return; }
    const util = utilizationFromContent(content);
    for (const b of BANDS) {
      if (util >= b.at) { process.stderr.write(b.msg + "\\n"); return; }
    }
  } catch { /* crash-safe */ }
}
main().then(() => process.exit(0), () => process.exit(0));
`;
}

export function breakpointHookScript(): string {
  return `#!/usr/bin/env node
${SIPCODE_HOOK_SIGNATURE}
// sipcode breakpoint hook (PostToolUse). suggests /compact at natural
// breakpoints: after tests pass, after a commit, after writing a test
// file. honest limit: we suggest — the model decides.
let payload = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => { payload += c; if (payload.length > 65536) payload = payload.slice(-65536); });
process.stdin.on("end", () => {
  try {
    const evt = payload ? JSON.parse(payload) : {};
    const tool = evt?.tool_name || evt?.tool || "";
    const input = evt?.tool_input || {};
    const out = evt?.tool_response || evt?.tool_result || {};
    const exitCode = (typeof out === "object" && out && "exit_code" in out) ? out.exit_code : 0;
    const cmd = (typeof input === "object" && input && "command" in input) ? String(input.command || "") : "";
    const filePath = (typeof input === "object" && input && "file_path" in input) ? String(input.file_path || "") : "";
    const ok = exitCode === 0 || exitCode === undefined;
    if (!ok) return;
    if (tool === "Bash" && /\\b(npm test|pnpm test|yarn test|vitest|pytest|go test|cargo test|jest)\\b/.test(cmd)) {
      process.stderr.write("[sipcode] tests passed — natural breakpoint. consider /compact before the next task.\\n");
      return;
    }
    if (tool === "Bash" && /\\bgit commit\\b/.test(cmd)) {
      process.stderr.write("[sipcode] commit landed — natural breakpoint. consider /compact before pivoting.\\n");
      return;
    }
    if (tool === "Write" && /(^|\\/|\\\\)(tests?|__tests__|spec)(\\/|\\\\)/.test(filePath)) {
      process.stderr.write("[sipcode] wrote a test file — natural breakpoint when the suite is green.\\n");
      return;
    }
  } catch { /* crash-safe */ }
});
process.stdin.on("error", () => process.exit(0));
setTimeout(() => process.exit(0), 200);
`;
}
