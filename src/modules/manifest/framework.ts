/**
 * framework — fingerprint the project's framework / build tool / languages.
 *
 * Pure module. Inputs are package.json (parsed) + a "does this path exist"
 * predicate + scanned files; never touches the disk.
 */
import type {
  FrameworkFingerprint,
  ScannedFile,
  SupportedLanguage,
} from "./types.js";

export interface FrameworkInput {
  readonly packageJson: unknown | undefined;
  readonly hasFile: (relPath: string) => boolean;
  readonly scanned: ReadonlyArray<ScannedFile>;
}

export function detectFramework(input: FrameworkInput): FrameworkFingerprint {
  const deps = collectDeps(input.packageJson);

  // Framework detection — order matters (more specific first).
  let framework: FrameworkFingerprint["framework"] = "unknown";
  if (deps.has("next")) {
    framework = input.hasFile("app/layout.tsx") ||
                input.hasFile("src/app/layout.tsx") ||
                input.hasFile("app/page.tsx") ||
                input.hasFile("src/app/page.tsx")
      ? "next-app"
      : "next-pages";
  } else if (deps.has("astro")) {
    framework = "astro";
  } else if (deps.has("@remix-run/react") || deps.has("@remix-run/node")) {
    framework = "remix";
  } else if (deps.has("@sveltejs/kit")) {
    framework = "sveltekit";
  } else if (deps.has("vite") && !deps.has("astro")) {
    framework = "vite";
  } else if (deps.has("express")) {
    framework = "express";
  } else if (deps.has("fastify")) {
    framework = "fastify";
  } else if (
    typeof input.packageJson === "object" &&
    input.packageJson !== null &&
    "bin" in input.packageJson &&
    (input.packageJson as { bin?: unknown }).bin
  ) {
    framework = "cli";
  } else if (
    typeof input.packageJson === "object" &&
    input.packageJson !== null &&
    "main" in input.packageJson
  ) {
    framework = "library";
  }

  // Build tool fingerprint.
  let buildTool: FrameworkFingerprint["buildTool"] = "unknown";
  if (deps.has("vite")) buildTool = "vite";
  else if (deps.has("webpack")) buildTool = "webpack";
  else if (deps.has("turbopack")) buildTool = "turbopack";
  else if (deps.has("rollup")) buildTool = "rollup";
  else if (deps.has("esbuild")) buildTool = "esbuild";
  else if (deps.has("typescript") || input.hasFile("tsconfig.json")) {
    buildTool = "tsc";
  }

  // Language fingerprint from scanned files.
  const langs = new Set<SupportedLanguage>();
  for (const s of input.scanned) {
    if (s.language === "typescript" || s.language === "javascript" ||
        s.language === "python" || s.language === "go") {
      langs.add(s.language);
    }
  }
  // Stable order.
  const ORDER: SupportedLanguage[] = ["typescript", "javascript", "python", "go"];
  const languages = ORDER.filter((l) => langs.has(l));

  return { framework, buildTool, languages };
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
