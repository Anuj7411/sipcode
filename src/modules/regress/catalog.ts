/**
 * Known, confirmed Claude Code regressions, and version helpers. Pure.
 *
 * Each catalog entry names the versions where the bug was live and the check
 * whose fingerprint it shows up as. A finding "matches" an entry when the
 * check is one of the entry's and the finding's version range overlaps the
 * entry's. Sources: Claude Code's CHANGELOG, the GitHub issues and the
 * postmortem named in `ref`.
 */

export type CheckId =
  | "warm-cache-miss"
  | "post-idle-cold"
  | "ttl-5m"
  | "uncached-input"
  | "hourly-rebuild"
  | "codex-limit-burn";

export interface KnownRegression {
  readonly id: string;
  readonly checks: readonly CheckId[];
  /** First and last affected version (inclusive). */
  readonly from: string;
  readonly to: string;
  readonly fixed: string;
  readonly what: string;
  readonly ref: string;
}

export const KNOWN: readonly KnownRegression[] = [
  {
    id: "R1",
    checks: ["uncached-input"],
    from: "2.1.257",
    to: "2.1.259",
    fixed: "2.1.260",
    what: "Fable 5.1 context after tool results re-sent as uncached input every tool-call turn",
    ref: "CHANGELOG 2.1.260",
  },
  {
    id: "R2",
    checks: ["warm-cache-miss"],
    from: "2.1.69",
    to: "2.1.89",
    fixed: "2.1.90",
    what: "--resume full prompt-cache miss (every message under --print --resume)",
    ref: "anthropics/claude-code#34629, CHANGELOG 2.1.90",
  },
  {
    id: "R3",
    checks: ["post-idle-cold", "warm-cache-miss"],
    from: "2.1.85",
    to: "2.1.100",
    fixed: "2.1.101",
    what: "thinking history cleared on every turn after an idle >1h, causing repeated cache misses",
    ref: "Anthropic April 23 postmortem",
  },
  {
    id: "R4",
    checks: ["ttl-5m"],
    from: "2.1.0",
    to: "2.1.128",
    fixed: "2.1.129",
    what: "1-hour prompt cache TTL silently downgraded to 5 minutes",
    ref: "anthropics/claude-code#46829, CHANGELOG 2.1.108 + 2.1.129",
  },
  {
    id: "R5",
    checks: ["hourly-rebuild"],
    from: "2.1.0",
    to: "2.1.247",
    fixed: "2.1.248",
    what: "OAuth token refresh re-rendered tool definitions, rebuilding the whole cache about hourly",
    ref: "CHANGELOG 2.1.248",
  },
];

function parts(v: string): [number, number, number] {
  const p = (v || "0.0.0").split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}

/** Compare two versions by their first three numeric parts ("2.1.9" < "2.1.10"). */
export function vcmp(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

export function inRange(v: string, from: string, to: string): boolean {
  return vcmp(v, from) >= 0 && vcmp(v, to) <= 0;
}

/** "0.142.0-alpha.3" → "0.142.0": a pre-release is compared as its release. */
export function releaseOf(v: string): string {
  return v.replace(/-.*/, "");
}

/** Catalog entries of `check` whose range overlaps from..to. */
export function matchKnown(check: CheckId, from: string, to: string): KnownRegression[] {
  return KNOWN.filter((k) => k.checks.includes(check) && vcmp(from, k.to) <= 0 && vcmp(to, k.from) >= 0);
}

/** Catalog ids whose range contains at least one of `versions`. */
export function knownWindowsCovered(versions: readonly string[]): string[] {
  return KNOWN.filter((k) => versions.some((v) => inRange(v, k.from, k.to))).map((k) => k.id);
}
