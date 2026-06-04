/**
 * Session Hygiene — types (S030 / S031 / S032).
 *
 * One mode for v0.3.0: "default". The shape is forward-compatible — we
 * may add a "strict" mode that fires pressure warnings earlier in v0.4.
 *
 * S033 (MCP-server pruning) is deferred to v1.1+; not modeled here.
 */
export type HygieneMode = "default";

export const HYGIENE_MODES: ReadonlyArray<HygieneMode> = ["default"];

export function isHygieneMode(s: unknown): s is HygieneMode {
  return s === "default";
}

/** The sub-block name written under the sipcode v=2 wrapper in CLAUDE.md. */
export const SESSION_HYGIENE_BLOCK_NAME = "session-hygiene";

/** Stable hook entry ids — recognized for upsert + uninstall. */
export const HOOK_PRESSURE_ID = "sipcode-pressure";
export const HOOK_BREAKPOINT_ID = "sipcode-breakpoint";
export const HOOK_PROXY_ID = "sipcode-proxy";

/** Detected state of session-hygiene in a project + user's claude settings. */
export interface HygieneState {
  /** CLAUDE.md sub-block present? */
  readonly blockInstalled: boolean;
  readonly blockMode?: HygieneMode;
  /** PreToolUse pressure hook registered? */
  readonly pressureHookInstalled: boolean;
  /** PostToolUse breakpoint hook registered? */
  readonly breakpointHookInstalled: boolean;
}

/** A rendered sub-block body for a given mode. */
export interface HygieneBlock {
  readonly mode: HygieneMode;
  readonly body: string;
}

/** Pressure band classification used by the hook + --check. */
export type PressureBand = "none" | "p50" | "p70" | "p90";

export interface PressureSample {
  readonly band: PressureBand;
  readonly utilization: number;
  readonly message: string;
}
