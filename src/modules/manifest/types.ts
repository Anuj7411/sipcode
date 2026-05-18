/**
 * Shared types for the manifest module.
 *
 * All paths in these types are POSIX-style relative paths from the project
 * root — they go straight into the generated manifest.md.
 */
import type { SipcodeIssue } from "../../lib/errors.js";

/** Languages the v1.0 manifest knows how to parse. */
export type SupportedLanguage = "typescript" | "javascript" | "python" | "go";

/** Anything else we list but don't parse. */
export type LanguageTag = SupportedLanguage | "other";

export interface ScannedFile {
  /** POSIX-style path relative to project root. */
  readonly path: string;
  /** Lowercase extension WITHOUT leading dot (e.g. "ts", "py"). */
  readonly ext: string;
  /** Size in bytes (for budget hints). */
  readonly size: number;
  /** Language tag for parser routing. */
  readonly language: LanguageTag;
}

export interface ParsedFile {
  readonly path: string;
  readonly language: LanguageTag;
  /** ~8-12 word human-readable purpose line for the file tree. */
  readonly purpose: string;
  /**
   * Intra-project relative imports as POSIX paths (resolved or best-effort).
   * External package names and stdlib are NOT included.
   */
  readonly imports: ReadonlyArray<string>;
  /**
   * Raw import specifiers as they appear in source — used by patterns.ts
   * to detect default vs named vs star imports.
   */
  readonly importStyles: ReadonlyArray<ImportStyle>;
}

export type ImportStyle = "default" | "named" | "star" | "side-effect";

export interface ImportGraph {
  /**
   * Map keyed by file path → 3-5 most "important" intra-project imports.
   * Importance heuristic: imports that are themselves imported by many
   * other files float to the top.
   */
  readonly edges: ReadonlyMap<string, ReadonlyArray<string>>;
}

export interface HotFile {
  readonly path: string;
  readonly changes: number;
}

export interface DetectedPatterns {
  readonly importStyle: "default" | "named" | "star" | "mixed" | "unknown";
  readonly naming: "camelCase" | "kebab-case" | "snake_case" | "PascalCase" | "mixed" | "unknown";
  readonly testFramework: "vitest" | "jest" | "mocha" | "pytest" | "go-test" | "none";
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  readonly monorepo: "single" | "workspaces" | "turbo" | "pnpm-workspace";
}

export interface FrameworkFingerprint {
  readonly framework:
    | "next-app"
    | "next-pages"
    | "astro"
    | "remix"
    | "sveltekit"
    | "vite"
    | "express"
    | "fastify"
    | "cli"
    | "library"
    | "unknown";
  readonly buildTool: "tsc" | "vite" | "webpack" | "turbopack" | "rollup" | "esbuild" | "unknown";
  readonly languages: ReadonlyArray<SupportedLanguage>;
}

export interface ManifestInputs {
  readonly projectName: string;
  readonly projectRoot: string;
  readonly headShort: string | undefined;
  readonly generatedAt: string;
  readonly files: ReadonlyArray<ScannedFile>;
  readonly parsed: ReadonlyArray<ParsedFile>;
  readonly importGraph: ImportGraph;
  readonly hotFiles: ReadonlyArray<HotFile>;
  readonly patterns: DetectedPatterns;
  readonly framework: FrameworkFingerprint;
  readonly issues: ReadonlyArray<SipcodeIssue>;
}

export interface RenderedManifest {
  readonly content: string;
  readonly tokenCount: number;
}
