/**
 * `sipcode receipt` — shareable savings receipt (S014).
 *
 * Thin orchestrator: reuses the `sipcode why` pipeline (discover → parse →
 * analyze → render-why), then renders a ReceiptModel and writes the artifacts.
 *
 * Outputs to `.sipcode/receipts/<session-short-id>/`:
 *   - `receipt.html` — standalone, no external deps
 *   - `receipt.png`  — 1200×630 OG-image (when native renderer loads)
 *
 * Also prints a tight terminal summary, a clickable file:// URL, and a
 * pre-filled tweet intent URL. Optionally copies the PNG to the system
 * clipboard.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import path from "node:path";
import { promises as nodeFs } from "node:fs";

import { RealFileSystem, type FileSystem } from "../lib/fs.js";
import { RealClock, type Clock } from "../lib/clock.js";
import { RealProcessEnv, type ProcessEnv } from "../lib/process.js";
import {
  RealClipboard,
  type Clipboard,
  type ClipboardResult,
} from "../lib/clipboard.js";
import { MESSAGES } from "../lib/messages.js";

import type { SipcodeIssue } from "../lib/errors.js";
import { resolveProjectsDir } from "../modules/transcript/discover.js";
import { parseTranscriptVerbose, type ParsedSession } from "../modules/transcript/parse.js";
import { analyzeTokens } from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { analyzeIdleContext } from "../modules/transcript/analyzers/idleContext.js";
import { analyzeTopExpensive } from "../modules/transcript/analyzers/topExpensive.js";
import { analyzeCounterfactual } from "../modules/transcript/analyzers/counterfactual.js";
import { renderReport } from "../modules/why/render.js";
import { daysSinceAsOf, loadPricingForDate, pricingAsOf } from "../lib/pricing/load.js";
import { resolveDisplayAgents, sectionHeader } from "../modules/agents/multi.js";
import {
  listAgentSessions,
  otherAgentHint,
  ownRequestsOnly,
  parseIssues,
  pickFrom,
  priceProvider,
  sessionPickError,
} from "../modules/agents/latest.js";

import { renderReceipt } from "../modules/receipt/render.js";
import { detectVariant } from "../modules/receipt/detect-variant.js";
import { formatTerminal } from "../modules/receipt/format-terminal.js";
import { formatHtml } from "../modules/receipt/format-html.js";
import {
  formatPng,
  type FontPack,
} from "../modules/receipt/format-png.js";
import { buildShareLinks } from "../modules/receipt/share.js";

export interface ReceiptOptions {
  session?: string;
  json?: boolean;
  here?: boolean;
  htmlOnly?: boolean;
  noShare?: boolean;
  cwd?: string;
  /** Which agent to source transcripts from. Default: auto (Claude Code and/or Codex). */
  agent?: string;
}

export interface ReceiptDeps {
  fs?: FileSystem;
  clock?: Clock;
  env?: ProcessEnv;
  clipboard?: Clipboard;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Pluggable writers so InMemoryFs tests don't hit disk. */
  writeFile?: (absPath: string, content: string | Uint8Array) => Promise<void>;
  /** Optional pre-loaded fonts (tests can pass empty buffers). */
  fonts?: FontPack;
}

export interface ReceiptResult {
  readonly exitCode: 0 | 1;
  /** Absolute path to receipt.html (POSIX separators). */
  readonly htmlPath?: string;
  /** Absolute path to receipt.png (POSIX). Undefined when --html-only or E008. */
  readonly pngPath?: string;
}

/** Default disk writer — the ONLY place this command may touch nodeFs. */
async function realWriteFile(
  absPath: string,
  content: string | Uint8Array,
): Promise<void> {
  await nodeFs.mkdir(path.dirname(absPath), { recursive: true });
  await nodeFs.writeFile(absPath, content);
}

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function pickSessionRoot(session: { cwd: string | undefined }): string | undefined {
  // ParsedSession.cwd reflects the agent's cwd at session start. We treat that
  // as the project root for variant detection. May be undefined for older logs.
  return session.cwd;
}

export async function runReceipt(
  opts: ReceiptOptions,
  deps: ReceiptDeps = {},
): Promise<ReceiptResult> {
  const fs = deps.fs ?? new RealFileSystem();
  const clock = deps.clock ?? new RealClock();
  const env = deps.env ?? new RealProcessEnv();
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const stderr = deps.stderr ?? ((s: string) => process.stderr.write(s + "\n"));
  const writeFile = deps.writeFile ?? realWriteFile;
  const clipboard = deps.clipboard ?? new RealClipboard(env);

  const cwd = opts.cwd ?? process.cwd();

  // Resolve agents: Claude Code and/or Codex (JSON: one tool). Explicit
  // --agent cursor exits cleanly with E009.
  const shown = await resolveDisplayAgents({
    agent: opts.agent,
    fs,
    env,
    clock,
    cwd,
    json: opts.json ?? false,
    stderr,
    singleSession: true,
  });
  if (!shown.ok) return { exitCode: 1 };
  const agents = shown.agents;
  if (agents.length === 1 && !agents[0]!.transcriptParsingSupported) {
    stderr(MESSAGES.cursorTranscriptNotSupported());
    return { exitCode: 1 };
  }
  // Claude Code alone keeps its original messages, byte for byte.
  const claudeOnly = agents.length === 1 && agents[0]!.id === "claude-code";

  // --- 1. discover ---
  const projectsDir = resolveProjectsDir(env);
  if (claudeOnly && !(await fs.exists(projectsDir))) {
    stderr(MESSAGES.noTranscriptsDir(projectsDir));
    return { exitCode: 1 };
  }
  const agentDeps = { fs, env, clock };
  const lists = await listAgentSessions({ agents, deps: agentDeps, cwd, here: opts.here });

  if (lists.every((l) => l.scoped.length === 0)) {
    stderr(
      claudeOnly
        ? MESSAGES.noSessionsFound(projectsDir)
        : MESSAGES.noAgentSessions("receipt", agents.map((a) => a.displayName), opts.here ?? false),
    );
    return { exitCode: 1 };
  }

  // The newest session (empty ones included, as before), or --session <prefix>.
  const picked = await pickFrom(lists, agentDeps, {
    sessionIdPrefix: opts.session,
    skipEmpty: false,
  });
  const pickError = sessionPickError({
    command: "receipt",
    picked,
    agents,
    sessionIdPrefix: opts.session,
    here: opts.here ?? false,
    projectsDir,
  });
  if (pickError !== undefined || !picked) {
    stderr(pickError ?? MESSAGES.noSessionsFound(projectsDir));
    return { exitCode: 1 };
  }
  const { agent, meta: chosen } = picked.chosen;

  // --- 2. parse ---
  let session: ParsedSession;
  let issues: SipcodeIssue[];
  if (agent.id === "claude-code") {
    let contents: string;
    try {
      contents = await fs.readFile(chosen.filePath);
    } catch {
      stderr(MESSAGES.malformedTranscript(path.basename(chosen.filePath), 0));
      return { exitCode: 1 };
    }
    ({ session, issues } = parseTranscriptVerbose(contents));
  } else {
    session = picked.chosen.parsed;
    issues = parseIssues(session);
  }
  // A resumed session (or a Codex fork) repeats requests another file holds:
  // report only this session's own, as the period commands count them.
  session = await ownRequestsOnly({ agent, deps: agentDeps, meta: chosen, parsed: session, lists });

  // --- 3. analyze ---
  const sessionDate = session.startedAt ? new Date(session.startedAt) : clock.now();
  const pricing = loadPricingForDate(sessionDate);
  const provider = priceProvider(agent);
  const asOf = pricingAsOf(pricing, provider);
  const ageDays = daysSinceAsOf(asOf, clock.now());
  const totals = analyzeTokens(session, pricing);
  const dups = analyzeDuplicateReads(session);
  const idle = analyzeIdleContext(session);
  const topEx = analyzeTopExpensive(session);
  const counter = analyzeCounterfactual(session, dups);

  // --- 4. render why-report ---
  const report = renderReport({
    session,
    totals,
    duplicates: dups,
    idle,
    topExpensive: topEx,
    counterfactual: counter,
    issues,
    projectHash: chosen.projectHash,
    pricingMeta: { asOf, ageDays },
    agentId: agent.id,
  });

  // --- 5. detect variant + render receipt model ---
  // Sipcode's savings features run inside Claude Code only, so a session from
  // another tool never gets the "sipped" (post-install) receipt.
  const projectRoot = pickSessionRoot(session);
  const variant =
    agent.id === "claude-code"
      ? await detectVariant(fs, {
          projectRoot,
          sessionStartedAt: session.startedAt,
        })
      : "pre-install";
  const model = renderReceipt({
    report,
    variant,
    sessionStartedAt: session.startedAt,
  });

  // --- 6. write artifacts (idempotent: bytes are deterministic) ---
  const slug = model.header.sessionIdShort;
  const outDir = path.resolve(cwd, ".sipcode", "receipts", slug);
  const htmlAbs = path.join(outDir, "receipt.html");
  const pngAbs = path.join(outDir, "receipt.png");

  // HTML always written.
  const html = formatHtml(model);
  await writeFile(htmlAbs, html);

  // PNG: try unless --html-only.
  let pngWritten = false;
  let pngWarning: string | undefined;
  if (!opts.htmlOnly) {
    const pngResult = await formatPng(model, deps.fonts ? { fonts: deps.fonts } : {});
    if (pngResult.ok) {
      await writeFile(pngAbs, pngResult.png);
      pngWritten = true;
    } else {
      pngWarning = MESSAGES.pngRendererUnavailable(
        posix(htmlAbs),
        pngResult.detail,
      );
    }
  }

  // --- 7. JSON output (machine-readable) — exit before terminal/share ---
  if (opts.json) {
    const payload = {
      schemaVersion: "sipcode-receipt/1",
      variant: model.variant,
      htmlPath: posix(htmlAbs),
      pngPath: pngWritten ? posix(pngAbs) : null,
      hero: {
        tokens: model.hero.tokens,
        tokensDisplay: model.hero.tokensDisplay,
        sublabel: model.hero.sublabel,
        dollarDisplay: model.hero.dollarDisplay,
        pricingAsOf: model.hero.pricingAsOf,
      },
      leaks: model.leaks,
      sessionIdShort: model.header.sessionIdShort,
      durationDisplay: model.header.durationDisplay,
      dateDisplay: model.header.dateDisplay,
    };
    stdout(JSON.stringify(payload, null, 2));
    return {
      exitCode: 0,
      htmlPath: posix(htmlAbs),
      ...(pngWritten ? { pngPath: posix(pngAbs) } : {}),
    };
  }

  // --- 8. terminal summary ---
  const useColor =
    env.get("NO_COLOR") === undefined && (process.stdout?.isTTY ?? false);
  // With both tools shown, name the tool the receipt is about.
  if (agents.length > 1) stdout(sectionHeader(agent.displayName));
  stdout(formatTerminal(model, { useColor }));

  // wrote ... + file:// link
  if (pngWritten) {
    stdout(MESSAGES.receiptWrote(posix(pngAbs)));
    stdout(`→ file://${posix(pngAbs)}`);
  } else {
    stdout(MESSAGES.receiptWrote(posix(htmlAbs)));
    stdout(`→ file://${posix(htmlAbs)}`);
  }

  // --- 9. share + clipboard ---
  if (!opts.noShare) {
    const links = buildShareLinks(model);
    stdout(`share it: ${links.tweetIntentUrl}`);

    if (pngWritten) {
      let result: ClipboardResult;
      try {
        result = await clipboard.copyPng(pngAbs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = {
          ok: false,
          strategy: clipboard.detect(),
          reason: `clipboard tool failed: ${msg}`,
        };
      }
      if (result.ok) {
        stdout(MESSAGES.receiptClipboardOk(result.strategy));
      } else {
        stdout(
          MESSAGES.receiptClipboardSkipped(
            result.reason ?? "skipped — use the file:// link above.",
          ),
        );
      }
    }
  }

  if (picked.others.length > 0) {
    stdout("");
    for (const o of picked.others) stdout(otherAgentHint(o));
  }

  // --- 10. warnings ---
  if (pngWarning) {
    stderr("");
    stderr(pngWarning);
  }
  if (ageDays > 30) {
    stderr("");
    stderr(MESSAGES.pricingStale(asOf, ageDays, provider));
  }

  return {
    exitCode: 0,
    htmlPath: posix(htmlAbs),
    ...(pngWritten ? { pngPath: posix(pngAbs) } : {}),
  };
}
