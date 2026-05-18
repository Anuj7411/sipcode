/**
 * Sipcode batched validation errors.
 *
 * Error mechanism rule for v0.1.0-alpha.1:
 *   - Pure analyzers / parsers return `Result<T, SipcodeIssue[]>`.
 *   - `SipcodeValidationError` may be THROWN only at I/O boundaries
 *     (commands, CLI entry). Pure runners must never throw.
 *
 * See docs/AUDIT-FRAMEWORK.md §"E — Validation errors".
 */

// CheckId is a branded string. We don't import it here to avoid a cycle —
// errors.ts is leaf-level, types.ts depends on it for validator throws.
type CheckIdLike = string & { readonly __brand: "CheckId" };

export type SipcodeErrorCode =
  | "E001" // manifest exceeded 2k token budget
  | "E002" // tree-sitter parse failed (warn, skip)
  | "E003" // transcript file unreadable or malformed
  | "E004" // pricing file out of date
  | "E005" // CLAUDE.md injection target unsafe to modify
  | "E006" // git not available — hot-files disabled
  | "E007" // unsupported language family
  // NOTE: AUDIT-FRAMEWORK.md table update for E008 is pending (planning docs
  // are locked for v0.1.0-alpha.3 — table-update tracked separately).
  | "E008"; // PNG renderer (resvg native binding) unavailable

export interface SipcodeIssue {
  readonly code: SipcodeErrorCode;
  readonly message: string;
  readonly related?: CheckIdLike;
  readonly path?: string;
}

export class SipcodeValidationError extends Error {
  public readonly issues: ReadonlyArray<SipcodeIssue>;
  constructor(issues: ReadonlyArray<SipcodeIssue>) {
    super(
      `sipcode found ${issues.length} issue(s): ${issues
        .map((i) => i.code)
        .join(", ")}`,
    );
    this.name = "SipcodeValidationError";
    this.issues = issues;
  }
}

export const issue = (
  code: SipcodeErrorCode,
  message: string,
  extra: { related?: CheckIdLike; path?: string } = {},
): SipcodeIssue => {
  const result: SipcodeIssue = {
    code,
    message,
    ...(extra.related !== undefined ? { related: extra.related } : {}),
    ...(extra.path !== undefined ? { path: extra.path } : {}),
  };
  return result;
};
