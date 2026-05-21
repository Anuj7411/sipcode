/**
 * budget — enforce S006 (2000-token cap on the manifest).
 *
 * Pure. Takes inputs + options; returns either a successful render or an
 * E001 issue. If `tighten` is on, progressively drops low-signal sections
 * and retries until under budget (or runs out of things to drop).
 */
import { err, ok, type Result } from "../../lib/result.js";
import { issue, type SipcodeIssue } from "../../lib/errors.js";
import { renderManifest, type ManifestSection } from "./render.js";
import type { ManifestInputs, RenderedManifest } from "./types.js";

export const DEFAULT_BUDGET_TOKENS = 2000;

export interface BudgetOptions {
  readonly budget?: number;
  readonly enforce?: boolean; // false ≈ --no-budget
  readonly tighten?: boolean;
}

const FULL_SECTIONS: ReadonlyArray<ManifestSection> = [
  "header",
  "framework",
  "patterns",
  "fileTree",
  "hotFiles",
  "importGraph",
];

/**
 * Ordered list of sections to drop when tightening, lowest-signal first.
 * Header / framework / patterns are essentials; we won't drop those.
 */
const TIGHTEN_DROP_ORDER: ReadonlyArray<ManifestSection> = [
  "importGraph", // largest section in most repos
  "hotFiles",    // useful but not foundational
  "fileTree",    // last-resort drop (heading remains, contents pruned via tree-mode)
];

export interface BudgetResult {
  readonly rendered: RenderedManifest;
  readonly sectionsUsed: ReadonlyArray<ManifestSection>;
  readonly tightened: boolean;
  readonly warnings: ReadonlyArray<SipcodeIssue>;
}

export function renderWithBudget(
  inputs: ManifestInputs,
  opts: BudgetOptions = {},
): Result<BudgetResult, SipcodeIssue[]> {
  const budget = opts.budget ?? DEFAULT_BUDGET_TOKENS;
  const enforce = opts.enforce ?? true;
  const warnings: SipcodeIssue[] = [];

  // First pass: full render.
  let sections = [...FULL_SECTIONS];
  let rendered = renderManifest(inputs, { sections });

  if (!enforce || rendered.tokenCount <= budget) {
    return ok({ rendered, sectionsUsed: sections, tightened: false, warnings });
  }

  if (!opts.tighten) {
    return err([
      issue(
        "E001",
        `manifest is ${rendered.tokenCount} tokens, over the ${budget}-token budget`,
      ),
    ]);
  }

  const originalTokens = rendered.tokenCount;

  // Tighten step 1: compact the file tree (drop per-file purposes).
  rendered = renderManifest(inputs, { sections, compactFileTree: true });
  if (rendered.tokenCount <= budget) {
    warnings.push(
      issue(
        "E001",
        `manifest tightened to fit ${budget}-token budget (was ${originalTokens}, now ${rendered.tokenCount}); compacted file tree`,
      ),
    );
    return ok({ rendered, sectionsUsed: sections, tightened: true, warnings });
  }

  // Tighten step 2: try directory-only mode for the file tree first.
  // Preserves the directory shape (most useful summary) when individual
  // files won't fit. Introduced v1.1.1 — fixes the over-aggressive
  // tighten that was stripping the file tree entirely on 250+-file repos.
  rendered = renderManifest(inputs, {
    sections,
    compactFileTree: true,
    directoryTreeOnly: true,
  });
  if (rendered.tokenCount <= budget) {
    warnings.push(
      issue(
        "E001",
        `manifest tightened to fit ${budget}-token budget (was ${originalTokens}, now ${rendered.tokenCount}); file tree shown as directories only`,
      ),
    );
    return ok({ rendered, sectionsUsed: sections, tightened: true, warnings });
  }

  // Tighten step 2: from here on, ALSO render file tree as directory-only
  // (dirs + counts, no individual files). For 250+ file repos, the file
  // tree dominates token cost — this fits the budget while still giving
  // the agent the directory shape. Introduced v1.1.1.
  rendered = renderManifest(inputs, {
    sections,
    compactFileTree: true,
    directoryTreeOnly: true,
  });
  if (rendered.tokenCount <= budget) {
    warnings.push(
      issue(
        "E001",
        `manifest tightened to fit ${budget}-token budget (was ${originalTokens}, now ${rendered.tokenCount}); file tree shown as directories only`,
      ),
    );
    return ok({ rendered, sectionsUsed: sections, tightened: true, warnings });
  }

  // Tighten step 3+: still over budget — drop sections in order, retaining
  // the directory-only file tree.
  for (const drop of TIGHTEN_DROP_ORDER) {
    sections = sections.filter((s) => s !== drop);
    rendered = renderManifest(inputs, {
      sections,
      compactFileTree: true,
      directoryTreeOnly: true,
    });
    if (rendered.tokenCount <= budget) {
      warnings.push(
        issue(
          "E001",
          `manifest tightened to fit ${budget}-token budget (was ${originalTokens}, now ${rendered.tokenCount}); compacted file tree (directories only), dropped sections beyond '${drop}'`,
        ),
      );
      return ok({
        rendered,
        sectionsUsed: sections,
        tightened: true,
        warnings,
      });
    }
  }

  // Couldn't tighten enough.
  return err([
    issue(
      "E001",
      `manifest is ${rendered.tokenCount} tokens even after tightening — over the ${budget}-token budget`,
    ),
  ]);
}
