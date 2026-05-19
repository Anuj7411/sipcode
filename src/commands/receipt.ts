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

import {
  findSessionById,
  listAllSessions,
  listSessionsHere,
  resolveProjectsDir,
  type SessionMeta,
} from "../modules/transcript/discover.js";
import { parseTranscriptVerbose } from "../modules/transcript/parse.js";
import { analyzeTokens } from "../modules/transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../modules/transcript/analyzers/duplicateReads.js";
import { analyzeIdleContext } from "../modules/transcript/analyzers/idleContext.js";
import { analyzeTopExpensive } from "../modules/transcript/analyzers/topExpensive.js";
import { analyzeCounterfactual } from "../modules/transcript/analyzers/counterfactual.js";
import { renderReport } from "../modules/why/render.js";
import { loadPricingForDate, pricingAgeDays } from "../lib/pricing/load.js";

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
  /** Which agent to source transcripts from. Default: claude-code. */
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

  // Resolve agent: receipt sources transcripts from claude-code only in this
  // milestone. Explicit --agent cursor exits cleanly with E009.
  if (opts.agent !== undefined && opts.agent !== "auto") {
    const { parseAgentFlag } = await import("../modules/agents/cli.js");
    const parsed = parseAgentFlag(opts.agent);
    if (!parsed.ok) {
      stderr(parsed.message);
      return { exitCode: 1 };
    }
    if (parsed.selector === "cursor") {
      stderr(MESSAGES.cursorTranscriptNotSupported());
      return { exitCode: 1 };
    }
  }

  // --- 1. discover ---
  const projectsDir = resolveProjectsDir(env);
  if (!(await fs.exists(projectsDir))) {
    stderr(MESSAGES.noTranscriptsDir(projectsDir));
    return { exitCode: 1 };
  }
  const cwd = opts.cwd ?? process.cwd();
  const sessions: SessionMeta[] = opts.here
    ? await listSessionsHere(fs, projectsDir, cwd)
    : await listAllSessions(fs, projectsDir);

  if (sessions.length === 0) {
    stderr(MESSAGES.noSessionsFound(projectsDir));
    return { exitCode: 1 };
  }

  let chosen: SessionMeta | undefined;
  if (opts.session) {
    chosen = await findSessionById(fs, projectsDir, opts.session);
    if (!chosen) {
      stderr(MESSAGES.sessionNotFound(opts.session));
      return { exitCode: 1 };
    }
  } else {
    chosen = sessions[0];
  }
  if (!chosen) {
    stderr(MESSAGES.noSessionsFound(projectsDir));
    return { exitCode: 1 };
  }

  // --- 2. parse ---
  let contents: string;
  try {
    contents = await fs.readFile(chosen.filePath);
  } catch {
    stderr(MESSAGES.malformedTranscript(path.basename(chosen.filePath), 0));
    return { exitCode: 1 };
  }
  const { session, issues } = parseTranscriptVerbose(contents);

  // --- 3. analyze ---
  const sessionDate = session.startedAt ? new Date(session.startedAt) : clock.now();
  const pricing = loadPricingForDate(sessionDate);
  const ageDays = pricingAgeDays(pricing, clock.now());
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
    pricingMeta: { asOf: pricing.as_of, ageDays },
  });

  // --- 5. detect variant + render receipt model ---
  const projectRoot = pickSessionRoot(session);
  const variant = await detectVariant(fs, {
    projectRoot,
    sessionStartedAt: session.startedAt,
  });
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

  // --- 10. warnings ---
  if (pngWarning) {
    stderr("");
    stderr(pngWarning);
  }
  if (ageDays > 30) {
    stderr("");
    stderr(MESSAGES.pricingStale(pricing.as_of, ageDays));
  }

  return {
    exitCode: 0,
    htmlPath: posix(htmlAbs),
    ...(pngWritten ? { pngPath: posix(pngAbs) } : {}),
  };
}
