/**
 * patterns — infer coding conventions from parsed files + package.json hints.
 *
 * Pure module. Inputs are pre-loaded text and parsed file array; we don't
 * touch the filesystem here.
 */
import type {
  DetectedPatterns,
  ParsedFile,
  ScannedFile,
} from "./types.js";

export interface PatternsInput {
  readonly parsed: ReadonlyArray<ParsedFile>;
  readonly scanned: ReadonlyArray<ScannedFile>;
  readonly packageJson: unknown | undefined;
  readonly hasFile: (relPath: string) => boolean;
}

export function detectPatterns(input: PatternsInput): DetectedPatterns {
  return {
    importStyle: detectImportStyle(input.parsed),
    naming: detectNaming(input.scanned),
    testFramework: detectTestFramework(input.packageJson, input.scanned),
    packageManager: detectPackageManager(input.hasFile, input.packageJson),
    monorepo: detectMonorepo(input.hasFile, input.packageJson),
  };
}

function detectImportStyle(
  parsed: ReadonlyArray<ParsedFile>,
): DetectedPatterns["importStyle"] {
  const counts = { default: 0, named: 0, star: 0, sideEffect: 0 };
  for (const f of parsed) {
    for (const s of f.importStyles) {
      if (s === "default") counts.default++;
      else if (s === "named") counts.named++;
      else if (s === "star") counts.star++;
      else counts.sideEffect++;
    }
  }
  const total = counts.default + counts.named + counts.star;
  if (total === 0) return "unknown";
  const top = (Object.entries(counts) as ReadonlyArray<[string, number]>)
    .filter(([k]) => k !== "sideEffect")
    .sort((a, b) => b[1] - a[1])[0];
  if (!top) return "unknown";
  const [name, n] = top;
  if (n / total < 0.6) return "mixed";
  if (name === "default") return "default";
  if (name === "named") return "named";
  if (name === "star") return "star";
  return "mixed";
}

function detectNaming(
  scanned: ReadonlyArray<ScannedFile>,
): DetectedPatterns["naming"] {
  const counts = { camel: 0, kebab: 0, snake: 0, pascal: 0 };
  // Look only at source files we own; skip test / config / generated.
  const SAMPLE_EXTS = new Set(["ts", "tsx", "js", "jsx", "mjs", "py", "go"]);
  for (const s of scanned) {
    if (!SAMPLE_EXTS.has(s.ext)) continue;
    const base = s.path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    if (base.length === 0) continue;
    if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(base)) counts.kebab++;
    else if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(base)) counts.snake++;
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(base)) counts.pascal++;
    else if (/^[a-z][a-zA-Z0-9]*$/.test(base)) counts.camel++;
  }
  const total = counts.camel + counts.kebab + counts.snake + counts.pascal;
  if (total === 0) return "unknown";
  const entries: ReadonlyArray<[DetectedPatterns["naming"], number]> = [
    ["camelCase", counts.camel],
    ["kebab-case", counts.kebab],
    ["snake_case", counts.snake],
    ["PascalCase", counts.pascal],
  ];
  const top = [...entries].sort((a, b) => b[1] - a[1])[0];
  if (!top) return "unknown";
  if (top[1] / total < 0.6) return "mixed";
  return top[0];
}

function detectTestFramework(
  pkg: unknown,
  scanned: ReadonlyArray<ScannedFile>,
): DetectedPatterns["testFramework"] {
  const deps = collectDeps(pkg);
  if (deps.has("vitest")) return "vitest";
  if (deps.has("jest") || deps.has("@jest/core")) return "jest";
  if (deps.has("mocha")) return "mocha";
  if (deps.has("pytest")) return "pytest";
  // Filename heuristics.
  for (const s of scanned) {
    if (/(_test\.go|\/[^/]+_test\.go)$/.test(s.path)) return "go-test";
    if (/test_.*\.py$|.*_test\.py$/.test(s.path)) return "pytest";
  }
  return "none";
}

function detectPackageManager(
  hasFile: (p: string) => boolean,
  pkg: unknown,
): DetectedPatterns["packageManager"] {
  // Check packageManager field first (modern source of truth).
  if (typeof pkg === "object" && pkg !== null && "packageManager" in pkg) {
    const v = (pkg as { packageManager?: unknown }).packageManager;
    if (typeof v === "string") {
      if (v.startsWith("pnpm")) return "pnpm";
      if (v.startsWith("yarn")) return "yarn";
      if (v.startsWith("bun")) return "bun";
      if (v.startsWith("npm")) return "npm";
    }
  }
  if (hasFile("pnpm-lock.yaml")) return "pnpm";
  if (hasFile("bun.lockb") || hasFile("bun.lock")) return "bun";
  if (hasFile("yarn.lock")) return "yarn";
  if (hasFile("package-lock.json")) return "npm";
  return "unknown";
}

function detectMonorepo(
  hasFile: (p: string) => boolean,
  pkg: unknown,
): DetectedPatterns["monorepo"] {
  if (hasFile("turbo.json")) return "turbo";
  if (hasFile("pnpm-workspace.yaml")) return "pnpm-workspace";
  if (
    typeof pkg === "object" &&
    pkg !== null &&
    "workspaces" in pkg &&
    (pkg as { workspaces?: unknown }).workspaces
  ) {
    return "workspaces";
  }
  return "single";
}

function collectDeps(pkg: unknown): Set<string> {
  const out = new Set<string>();
  if (typeof pkg !== "object" || pkg === null) return out;
  const fields = ["dependencies", "devDependencies", "peerDependencies"];
  for (const f of fields) {
    const v = (pkg as Record<string, unknown>)[f];
    if (v && typeof v === "object") {
      for (const k of Object.keys(v)) out.add(k);
    }
  }
  return out;
}
