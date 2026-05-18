/**
 * Output Compression — types.
 *
 * Three modes (S022):
 *   - default: aggressive but reasonable (diff output, no preamble, ...)
 *   - strict:  default + telegraphic voice (no leading articles, ...)
 *   - verbose: default + learning annotations (trade-offs, citations, ...)
 *
 * strict and verbose are mutually exclusive — both extend default.
 */
export type RulesMode = "default" | "strict" | "verbose";

export const RULES_MODES: ReadonlyArray<RulesMode> = [
  "default",
  "strict",
  "verbose",
];

export function isRulesMode(s: unknown): s is RulesMode {
  return s === "default" || s === "strict" || s === "verbose";
}

/** The sub-block name we write under the sipcode wrapper. */
export const OUTPUT_COMPRESSION_BLOCK_NAME = "output-compression";

/**
 * Detected state of the output-compression sub-block in a CLAUDE.md file.
 */
export interface RulesState {
  readonly installed: boolean;
  readonly mode?: RulesMode;
}

/** A rendered sub-block body for a given mode. */
export interface RulesBlock {
  readonly mode: RulesMode;
  readonly body: string;
}
