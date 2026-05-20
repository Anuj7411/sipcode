/**
 * All user-facing strings live here.
 *
 * Voice: lowercase, no jargon, structured as (a) what happened (b) why
 * (c) how to fix (d) suggested next command.
 */
export const MESSAGES = {
  tagline: "sip your tokens. don't gulp them.",

  notImplemented: (cmd: string, milestone: string) =>
    `sipcode ${cmd} — not yet implemented (planned for ${milestone}).`,

  noTranscriptsDir: (path: string) =>
    [
      `[E003] no claude code transcripts found at ${path}`,
      ``,
      `why: sipcode looks here for past session logs that claude code writes itself. either claude code isn't installed, you haven't used it yet, or transcripts live somewhere custom.`,
      ``,
      `fix: open claude code and run any prompt — it'll create the folder. or point sipcode at a custom path: SIPCODE_PROJECTS_DIR=/your/path npx sipcode why`,
      ``,
      `next: npx sipcode why --list`,
    ].join("\n"),

  noSessionsFound: (path: string) =>
    [
      `[E003] no session files inside ${path}`,
      ``,
      `why: the folder exists but no .jsonl transcripts live in it. claude code writes a transcript per session — none have run here yet, or they've been cleaned out.`,
      ``,
      `fix: open claude code, run any prompt, then come back.`,
      ``,
      `next: npx sipcode why --list`,
    ].join("\n"),

  sessionNotFound: (id: string) =>
    [
      `[E003] no session matches "${id}"`,
      ``,
      `why: sipcode couldn't find a .jsonl whose name starts with that id.`,
      ``,
      `fix: list available sessions and pick a real id.`,
      ``,
      `next: npx sipcode why --list`,
    ].join("\n"),

  malformedTranscript: (file: string, badLines: number) =>
    [
      `[E003] one of your session files looks corrupted: ${file}`,
      ``,
      `why: claude code sometimes writes partial json when it crashes. sipcode read what it could and skipped ${badLines} bad line(s).`,
      ``,
      `fix: you can ignore this — the report shows partial numbers, flagged below. to audit a different session: sipcode why --list and pick another.`,
      ``,
      `next: sipcode why --list`,
    ].join("\n"),

  pricingStale: (asOf: string, days: number) =>
    [
      `[E004] pricing is ${days} days old (file dated ${asOf})`,
      ``,
      `why: anthropic's pricing may have changed since this pricing file shipped. cost numbers below are an estimate, not a guarantee.`,
      ``,
      `fix: update sipcode (npm i -g sipcode@latest) for the freshest pricing.`,
      ``,
      `next: npx sipcode why`,
    ].join("\n"),

  noUsageBlocks:
    "[E003] this session has no token-usage data (older claude code version). showing structural numbers only.",

  banner: (sessionId: string, projectHash: string) =>
    `(showing latest session ${sessionId} from ${projectHash}; pass --here to scope to this directory)`,

  // ---- manifest milestone (v0.1.0-alpha.2) ----

  manifestOverBudget: (actual: number, budget: number) =>
    [
      `[E001] manifest is ${actual} tokens — over the ${budget}-token budget.`,
      ``,
      `why: sipcode's whole point is keeping context small. a manifest that doesn't fit in budget defeats the purpose — your agent will read it AND still grep for more.`,
      ``,
      `fix: drop low-signal sections automatically with --tighten, or bypass once with --no-budget if you know what you're doing.`,
      ``,
      `next: npx sipcode manifest --tighten`,
    ].join("\n"),

  manifestParseSkipped: (file: string, reason: string) =>
    [
      `[E002] couldn't parse ${file}`,
      ``,
      `why: ${reason}`,
      ``,
      `fix: skipped — the manifest will still ship without this file's import graph entry. if many files are skipped, the grammar package may not be installed for your platform.`,
      ``,
      `next: npx sipcode manifest --explain ${file}`,
    ].join("\n"),

  claudeMdUnsafe: (path: string) =>
    [
      `[E005] ${path} has hand-edited content inside the sipcode markers.`,
      ``,
      `why: sipcode injects a fixed block between <!-- sipcode:start --> and <!-- sipcode:end -->. anything inside those markers is sipcode's territory. if you've edited it, sipcode won't blow your changes away.`,
      ``,
      `fix: pull your edits out of the markers (move them above or below), then re-run init. or delete the entire marker block to start fresh.`,
      ``,
      `next: npx sipcode init`,
    ].join("\n"),

  gitUnavailable:
    [
      `[E006] git not available — hot-files index disabled.`,
      ``,
      `why: sipcode reads git history to find your hottest files (top 20 by change frequency in the last 90 days). without git on PATH, that section gets skipped.`,
      ``,
      `fix: install git, or ignore — the manifest still ships, just without hot-files.`,
      ``,
      `next: npx sipcode manifest`,
    ].join("\n"),

  unsupportedLanguage: (file: string, ext: string) =>
    [
      `[E007] ${file} uses an unsupported language (${ext}) — skipped from manifest.`,
      ``,
      `why: v1.0 ships grammars for typescript, javascript, python, and go. other languages are listed in the file tree but skipped for import graph and pattern detection.`,
      ``,
      `fix: open an issue at https://github.com/Anuj7411/sipcode if you want this language prioritized.`,
      ``,
      `next: npx sipcode manifest`,
    ].join("\n"),

  manifestBudgetWarn: (actual: number, budget: number) =>
    [
      `[R001] manifest is ${actual} tokens (budget ${budget}). sipcode trimmed low-signal sections to fit.`,
      ``,
      `why: large repos hit the budget naturally. --tighten dropped the lowest-signal entries first (long files in deep test dirs, then long imports).`,
      ``,
      `fix: review the manifest and consider adding skip patterns in .sipcodeignore for generated code or vendored libraries.`,
      ``,
      `next: cat .sipcode/manifest.md`,
    ].join("\n"),

  claudeMdBloated: (tokens: number) =>
    [
      `[R007] CLAUDE.md is ${tokens} tokens — getting bloated.`,
      ``,
      `why: every prompt pays for CLAUDE.md. anything past ~4000 tokens is taxing every turn forever.`,
      ``,
      `fix: trim down. a CLAUDE.md compressor ships in a later milestone.`,
      ``,
      `next: cat CLAUDE.md | wc -c`,
    ].join("\n"),

  // ---- receipt milestone (v0.1.0-alpha.3) ----

  pngRendererUnavailable: (htmlPath: string, detail?: string) =>
    [
      `[E008] couldn't render the png — native renderer didn't load on this system.`,
      ``,
      `why: @resvg/resvg-js ships native bindings; some platforms (alpine linux, musl, some bun versions) don't have a compatible build.${detail ? ` (${detail})` : ""} the html receipt is still ready — you can screenshot it manually.`,
      ``,
      `fix: open the html in your browser and screenshot it: file://${htmlPath}`,
      ``,
      `next: open ${htmlPath}`,
    ].join("\n"),

  receiptWrote: (pngPath: string) => `wrote ${pngPath}`,

  receiptClipboardOk: (strategy: string) =>
    `copied png to clipboard (${strategy}). paste it anywhere.`,

  receiptClipboardSkipped: (reason: string) => `clipboard: ${reason}`,

  manifestDeltaNotImplemented:
    "[planned] --delta is stubbed for v1.1+. for now, re-run `sipcode manifest` to regenerate from scratch — it's idempotent on unchanged trees, so diffs against the prior version are easy to read.",

  manifestExplainNotImplemented: (file: string) =>
    `[planned] --explain ${file} lands in v1.1+. for now, the [E002] line printed during generation tells you why a file was skipped.`,

  // ---- output compression milestone (v0.2.0) ----

  rulesInstalledAt: (mode: string, claudeMdPath: string) =>
    `installed output compression (${mode} mode) in ${claudeMdPath}.`,

  rulesAlreadyInstalled: (mode: string) =>
    `already installed at ${mode} mode. no changes.`,

  rulesSwitchedMode: (from: string, to: string, claudeMdPath: string) =>
    `switched output compression: ${from} -> ${to} in ${claudeMdPath}.`,

  rulesUninstalled: (claudeMdPath: string) =>
    `removed output compression block from ${claudeMdPath}.`,

  rulesNotInstalled: "output compression rules are not installed. run `npx sipcode rules --install` to add them.",

  rulesActive: (mode: string) =>
    `output compression: installed, mode = ${mode}.`,

  rulesDiffIdentical: "no changes — claude.md is already in the requested state.",

  rulesNoClaudeMd: (path: string) =>
    `${path} does not exist yet. --install will create it.`,

  // ---- multi-agent milestone (v0.2.0-alpha.3, S043) ----

  agentDetectedAuto: (id: string) =>
    `detected agent: ${id} (auto). pass --agent to override.`,

  agentAmbiguous: () =>
    [
      `both claude code and cursor look configured here.`,
      `pass --agent claude-code or --agent cursor to be explicit.`,
      `defaulting to claude-code.`,
    ].join("\n"),

  cursorTranscriptNotSupported: () =>
    [
      `[E009] cursor transcript parsing isn't supported yet.`,
      ``,
      `why: cursor's chat history schema is internal and unstable across versions. sipcode won't guess at it.`,
      ``,
      `fix: use claude code for transcript audits, or open an issue with your cursor version so we can prioritize.`,
      ``,
      `next: npx sipcode why --agent claude-code`,
    ].join("\n"),

  cursorRulesInstalled: (rulesPath: string) =>
    `wrote sipcode rules to ${rulesPath}. cursor will pick them up on next session.`,

  cursorNotDetected: (cwd: string) =>
    [
      `cursor doesn't look configured at ${cwd}.`,
      ``,
      `why: no .cursor/ directory or .cursorrules file here, and no global ~/.cursor/.`,
      ``,
      `fix: run cursor in this directory at least once, or run \`sipcode init --agent claude-code\` instead.`,
      ``,
      `next: npx sipcode init --agent claude-code`,
    ].join("\n"),

  // ---- stats milestone (v0.2.0-alpha.4, S040) ----

  statsBadSince: (raw: string) =>
    [
      `[E010] couldn't parse --since "${raw}".`,
      ``,
      `why: sipcode accepts a duration like 7d / 30d / 90d, the keyword "all", or a yyyy-mm-dd date.`,
      ``,
      `fix: try --since 30d, --since all, or --since 2026-04-01.`,
      ``,
      `next: npx sipcode stats --since 30d`,
    ].join("\n"),

  statsBadTopN: (raw: string) =>
    [
      `[E010] couldn't parse --top "${raw}".`,
      ``,
      `why: --top wants a positive integer (1-100).`,
      ``,
      `fix: try --top 5 or --top 10.`,
      ``,
      `next: npx sipcode stats --top 10`,
    ].join("\n"),

  statsBadGroupBy: (raw: string) =>
    [
      `[E010] couldn't parse --group-by "${raw}".`,
      ``,
      `why: --group-by supports: none, project.`,
      ``,
      `fix: try --group-by project, or drop the flag for the default view.`,
      ``,
      `next: npx sipcode stats --group-by project`,
    ].join("\n"),

  statsNoSessionsInWindow: (raw: string) =>
    [
      `no sessions found in the last ${raw}.`,
      ``,
      `why: claude code transcripts exist, but none of them fall inside the window you asked for.`,
      ``,
      `fix: widen the window with --since all, or drop --here if you scoped to this cwd.`,
      ``,
      `next: npx sipcode stats --since all`,
    ].join("\n"),

  statsHtmlWrote: (path: string) => `wrote ${path}`,

  // ---- score milestone (v0.2.0-alpha.5, S060) ----

  scoreBadThreshold: (raw: string) =>
    [
      `[E011] couldn't parse --threshold "${raw}".`,
      ``,
      `why: --threshold wants an integer between 0 and 100.`,
      ``,
      `fix: try --threshold 70 or --threshold 80.`,
      ``,
      `next: npx sipcode score --threshold 70`,
    ].join("\n"),

  scoreHtmlWrote: (path: string) => `wrote ${path}`,

  scoreBadgeWrote: (path: string) =>
    `wrote ${path} — add a badge with: ![sipcode score](https://img.shields.io/endpoint?url=<your-host>/badge.json)`,

  scoreBelowThreshold: (score: number, threshold: number) =>
    [
      `[E011] score ${score} is below threshold ${threshold}.`,
      ``,
      `why: --threshold gates this command — the score didn't clear the bar.`,
      ``,
      `fix: read the recommendations above and address the highest-point items first, or lower --threshold for CI.`,
      ``,
      `next: npx sipcode score --html  # open the detailed report`,
    ].join("\n"),

  agentUnknown: (id: string) =>
    [
      `unknown agent "${id}".`,
      ``,
      `why: sipcode supports --agent claude-code and --agent cursor in this release. codex / gemini / aider are planned.`,
      ``,
      `fix: pick one of: claude-code, cursor, auto.`,
      ``,
      `next: npx sipcode init --agent auto`,
    ].join("\n"),

  // ---- benchmark milestone (v0.2.0-alpha.6 / S110) ----

  benchmarkTaskNotFound: (id: string) =>
    [
      `no benchmark task matches "${id}".`,
      ``,
      `why: task ids are stable (BT001 through BT010). they never get renamed or renumbered.`,
      ``,
      `fix: list available tasks and pick a real id.`,
      ``,
      `next: npx sipcode benchmark --list`,
    ].join("\n"),

  benchmarkEmptyCorpus: (dir: string) =>
    [
      `no tasks loaded from ${dir}.`,
      ``,
      `why: the corpus directory exists but contains no task subdirectories.`,
      ``,
      `fix: re-clone the sipcode repo or run from a sipcode checkout.`,
      ``,
      `next: npx sipcode benchmark --list`,
    ].join("\n"),

  benchmarkTranscriptMissing: (taskId: string) =>
    [
      `[E003] ${taskId}: couldn't read transcript pair.`,
      ``,
      `why: each task ships baseline-transcript.jsonl and optimized-transcript.jsonl. one or both is missing.`,
      ``,
      `fix: verify benchmark/corpus/${taskId}/ has both files.`,
      ``,
      `next: ls benchmark/corpus/${taskId}/`,
    ].join("\n"),

  // ---- session hygiene milestone (v0.3.0, S030/S031/S032) ----

  hygieneInstalled: (claudeMdPath: string, hooksDir: string) =>
    [
      `installed session hygiene.`,
      `  rules block -> ${claudeMdPath}`,
      `  hook scripts -> ${hooksDir}`,
      `  registered: PreToolUse (pressure) + PostToolUse (breakpoint).`,
      ``,
      `honest limit: sipcode hooks warn — they can't force /compact.`,
      `the model still decides. that's the design.`,
    ].join("\n"),

  hygieneAlreadyInstalled: () =>
    "session hygiene already installed. no changes.",

  hygieneUninstalled: (claudeMdPath: string) =>
    `removed session hygiene block + hook entries (settings.json restored modulo our entries). ${claudeMdPath} cleaned.`,

  hygieneNotInstalled:
    "session hygiene not installed. run `npx sipcode hygiene --install` to add it.",

  hygieneStatus: (state: {
    blockInstalled: boolean;
    blockMode?: string;
    pressureHookInstalled: boolean;
    breakpointHookInstalled: boolean;
  }) =>
    [
      `session hygiene status:`,
      `  CLAUDE.md block:     ${state.blockInstalled ? `installed (mode = ${state.blockMode ?? "unknown"})` : "not installed"}`,
      `  pressure hook:       ${state.pressureHookInstalled ? "registered" : "not registered"}`,
      `  breakpoint hook:     ${state.breakpointHookInstalled ? "registered" : "not registered"}`,
    ].join("\n"),

  hygieneDiffIdentical: "no changes — hygiene is already in the requested state.",

  hygieneCheckBand: (band: string, util: number, message: string) =>
    [
      `dry-run pressure check on your latest claude code transcript:`,
      `  utilization: ~${Math.round(util * 100)}% of approx context window`,
      `  band: ${band}`,
      `  hook would print: ${message}`,
    ].join("\n"),

  hygieneCheckNoTranscript: (path: string) =>
    `no claude code transcripts at ${path} — nothing to check yet.`,

  hygieneMcpDeferred:
    "[planned] S033 mcp-server pruning detector lands in v1.1+. hooks shipped today cover S030/S031/S032.",

  benchmarkAllFailed: () =>
    [
      `every task failed to run.`,
      ``,
      `why: the transcripts couldn't be parsed or the corpus is corrupt.`,
      ``,
      `fix: re-clone the sipcode repo — the corpus is locked in git.`,
      ``,
      `next: git status benchmark/corpus`,
    ].join("\n"),
} as const;
