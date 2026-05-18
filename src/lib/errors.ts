/**
 * Sipcode batched validation errors.
 *
 * See docs/AUDIT-FRAMEWORK.md §"E — Validation errors" for the full code table.
 *
 * Rule: never throw on first failure mid-flight. Collect issues into an
 * array, return a `SipcodeValidationError` with all of them.
 */
import type { CheckId } from "./types.js";

export type SipcodeErrorCode =
  | "E001"  // manifest exceeded 2k token budget
  | "E002"  // tree-sitter parse failed (warn, skip)
  | "E003"  // transcript file unreadable or malformed
  | "E004"  // pricing file out of date
  | "E005"  // CLAUDE.md injection target unsafe to modify
  | "E006"  // git not available — hot-files disabled
  | "E007"; // unsupported language family

export interface SipcodeIssue {
  code: SipcodeErrorCode;
  message: string;
  related?: CheckId | undefined;
  path?: string | undefined;
}

export class SipcodeValidationError extends Error {
  constructor(public readonly issues: ReadonlyArray<SipcodeIssue>) {
    super(
      `Sipcode found ${issues.length} issue(s): ${issues
        .map((i) => i.code)
        .join(", ")}`,
    );
    this.name = "SipcodeValidationError";
  }
}
