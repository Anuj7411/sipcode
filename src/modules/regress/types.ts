/** Shapes shared by the regress checks, report and formatters. */
import type { CheckId, KnownRegression } from "./catalog.js";

export interface Finding {
  readonly id: CheckId;
  readonly agent: "claude-code" | "codex";
  readonly title: string;
  /** First and last version of the flagged range (equal for one version). */
  readonly from: string;
  readonly to: string;
  /** Catalog entries the range matches (empty: not in the known-issue catalog). */
  readonly known: readonly KnownRegression[];
  /** One line per flagged version (or version and model), numbers as printed. */
  readonly evidence: readonly string[];
  /** Up to 3 sample requests: short session id, time, token counts. */
  readonly examples: readonly string[];
  readonly note: string | null;
}
