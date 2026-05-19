/**
 * Shared types for the `sipcode score` module (S060).
 *
 * Score = static-analysis "agent-friendliness" audit of a codebase. Distinct
 * from agent-configuration audits (e.g. ecc-agentshield): we score the repo
 * itself, not the agent's settings.
 *
 * Stable check IDs (SC###) are public API — once shipped, never rename.
 */
import type {
  ParsedFile,
  ScannedFile,
  DetectedPatterns,
  FrameworkFingerprint,
} from "../manifest/types.js";

/** Branded check id, e.g. "SC001". */
export type CheckId = string & { readonly __brand: "CheckId" };

/** Branded category id, e.g. "A". */
export type CategoryId = "A" | "B" | "C" | "D" | "E";

export const CATEGORY_NAMES: Readonly<Record<CategoryId, string>> = {
  A: "manifest & routing",
  B: "directory shape",
  C: "naming clarity",
  D: "documentation density",
  E: "predictability",
} as const;

/** Tier badge mapped from final 0-100 score. */
export type Tier = "platinum" | "gold" | "silver" | "bronze" | "needs-work";

/**
 * The single source of truth fed into every check. Built once from the
 * project root, then handed to all check runners.
 */
export interface CodebaseSnapshot {
  /** Project root (absolute path; informational only — checks must not do I/O). */
  readonly projectRoot: string;
  /** Project display name (from package.json or basename of root). */
  readonly projectName: string;

  // ---- File listing (from manifest/scanFiles). ----
  readonly scanned: ReadonlyArray<ScannedFile>;
  /** Quick lookup: relative-POSIX path → ScannedFile. */
  readonly fileIndex: ReadonlyMap<string, ScannedFile>;
  /** True if a given path (POSIX-relative) exists in the scan. */
  readonly hasFile: (relPath: string) => boolean;

  // ---- Selectively-read file contents (only the small fingerprint files). ----
  /** Raw contents of CLAUDE.md if present. */
  readonly claudeMd: string | undefined;
  /** Raw contents of README.md (or README) if present. */
  readonly readme: string | undefined;
  /** Raw contents of AGENTS.md if present. */
  readonly agentsMd: string | undefined;
  /** Raw contents of .cursorrules if present. */
  readonly cursorRules: string | undefined;
  /** Raw contents of .sipcode/manifest.md if present. */
  readonly sipcodeManifest: string | undefined;
  /** Raw package.json (parsed, untyped) if present. */
  readonly packageJson: unknown | undefined;
  /** Parsed pyproject.toml content (raw text) if present. */
  readonly pyprojectToml: string | undefined;
  /** Raw go.mod content if present. */
  readonly goMod: string | undefined;

  // ---- Manifest module results (cached so we don't re-run them per check). ----
  readonly parsed: ReadonlyArray<ParsedFile>;
  readonly patterns: DetectedPatterns;
  readonly framework: FrameworkFingerprint;

  // ---- LOC counts for source files (large files matter for SC012, SC022). ----
  /** path → estimated line count. */
  readonly lineCounts: ReadonlyMap<string, number>;
  /** path → first-line-of-file comment (or undefined). */
  readonly firstLineComment: ReadonlyMap<string, string | undefined>;
}

/** A single check's static metadata + pure runner. */
export interface CheckDef {
  readonly id: CheckId;
  readonly category: CategoryId;
  /** Short human-readable label, e.g. "CLAUDE.md exists at repo root". */
  readonly label: string;
  /** Points awarded if `passed`. Sum of every check's maxPoints = 100. */
  readonly maxPoints: number;
  /**
   * Pure runner. Receives the snapshot; returns whether it passed and an
   * optional human-readable details string for recommendations.
   */
  readonly run: (snap: CodebaseSnapshot) => CheckRun;
}

/** A check runner's return value. */
export interface CheckRun {
  readonly passed: boolean;
  /** Optional "what's wrong" detail when !passed. */
  readonly details?: string;
}

/** A check's result after being run. */
export interface CheckResult {
  readonly id: CheckId;
  readonly category: CategoryId;
  readonly label: string;
  readonly passed: boolean;
  readonly points: number;
  readonly maxPoints: number;
  readonly details?: string;
}

/** A category aggregate, derived from check results. */
export interface CategoryScore {
  readonly id: CategoryId;
  readonly name: string;
  readonly score: number;
  readonly max: number;
}

/** The full score report — primary in-memory type. */
export interface ScoreReport {
  readonly schemaVersion: "sipcode-score/1";
  readonly project: {
    readonly name: string;
    readonly filesScanned: number;
  };
  readonly score: number;
  readonly tier: Tier;
  readonly categories: ReadonlyArray<CategoryScore>;
  readonly checks: ReadonlyArray<CheckResult>;
  readonly recommendations: ReadonlyArray<string>;
  readonly metaGenerator: {
    readonly version: string;
    readonly asOf: string;
  };
}

/** Helper — brand a literal string as a CheckId. */
export const checkId = (raw: string): CheckId => raw as CheckId;
