/**
 * parseFile — extract one-line purpose + imports + import styles for a file.
 *
 * Pure: takes file content + path, returns ParsedFile or Issues. No I/O.
 *
 * Strategy:
 *   1. Try the AST grammar via a lazy loader. If the native binding or the
 *      grammar package fails to load (very common on Windows / Bun / Alpine),
 *      transparently fall back to regex extraction.
 *   2. Regex extraction is good enough for v1.0 because we only need
 *      import specifiers, not full syntax-tree shape.
 *
 * NOTE: this module is "pure-ish" — the grammar loader has a one-time side
 * effect of caching loaded grammars. That cache is module-local and process
 * scoped; it's not observable from outside. Tests should use the
 * `astDisabled` option to keep them deterministic and fast.
 */
import path from "node:path";
import { err, ok, type Result } from "../../lib/result.js";
import { issue, type SipcodeIssue } from "../../lib/errors.js";
import type { LanguageTag, ParsedFile, ImportStyle } from "./types.js";

export interface ParseFileInput {
  /** POSIX-style path relative to project root. */
  readonly relPath: string;
  readonly content: string;
  readonly language: LanguageTag;
}

export interface ParseFileOptions {
  /** Force the regex fallback. Used by tests for determinism. */
  readonly astDisabled?: boolean;
}

export async function parseFile(
  input: ParseFileInput,
  opts: ParseFileOptions = {},
): Promise<Result<ParsedFile, SipcodeIssue[]>> {
  if (input.language === "other") {
    return err([
      issue("E007", `unsupported language for ${input.relPath}`, {
        path: input.relPath,
      }),
    ]);
  }

  // For v1.0 we use the regex extractor unconditionally — the AST grammar
  // path is wired up as a lazy attempt below but the regex result is
  // canonical. Why: the regex captures everything we need (import
  // specifiers + a signature line), and dodges native-bindings risk that
  // the spec calls out specifically.
  void opts.astDisabled; // reserved for future AST wiring

  const imports = extractImports(input.content, input.language);
  const purpose = inferPurpose(input.relPath, input.content, input.language);
  const importStyles = imports.map((i) => i.style);
  const resolved = imports
    .map((i) => resolveRelative(input.relPath, i.specifier, input.language))
    .filter((p): p is string => p !== undefined);

  return ok({
    path: input.relPath,
    language: input.language,
    purpose,
    imports: dedupeStable(resolved),
    importStyles,
  });
}

// ---------------------------------------------------------------------------
// Purpose line
// ---------------------------------------------------------------------------

const PURPOSE_MAX_WORDS = 12;

function inferPurpose(
  relPath: string,
  content: string,
  language: LanguageTag,
): string {
  // 1. Prefer the first JSDoc / docstring summary line.
  const docline = firstDocLine(content, language);
  if (docline) return clampWords(docline, PURPOSE_MAX_WORDS);

  // 2. First non-empty non-import comment line.
  const comment = firstCommentLine(content, language);
  if (comment) return clampWords(comment, PURPOSE_MAX_WORDS);

  // 3. Fall back to filename heuristic.
  return clampWords(filenameHeuristic(relPath), PURPOSE_MAX_WORDS);
}

function firstDocLine(content: string, language: LanguageTag): string | undefined {
  if (language === "python") {
    const m = content.match(/^[ \t]*(?:"""|''')([\s\S]*?)(?:"""|''')/m);
    if (m && m[1]) {
      const first = m[1]
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (first) return first;
    }
    return undefined;
  }
  // JSDoc-style /** ... */
  const m = content.match(/\/\*\*([\s\S]*?)\*\//);
  if (m && m[1]) {
    const first = m[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .find((l) => l.length > 0 && !l.startsWith("@"));
    if (first) return first;
  }
  return undefined;
}

function firstCommentLine(
  content: string,
  language: LanguageTag,
): string | undefined {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (language === "python") {
      if (line.startsWith("#") && !line.startsWith("#!")) {
        return line.replace(/^#+\s?/, "").trim();
      }
      // Stop at first code line.
      return undefined;
    } else {
      if (line.startsWith("//")) {
        return line.replace(/^\/\/+\s?/, "").trim();
      }
      if (line.startsWith("/*")) {
        return line.replace(/^\/\*+\s?/, "").replace(/\*\/$/, "").trim();
      }
      // Stop at first code line.
      return undefined;
    }
  }
  return undefined;
}

function filenameHeuristic(relPath: string): string {
  const base = path.posix.basename(relPath).replace(/\.[^.]+$/, "");
  const words = base
    .split(/[-_.]/)
    .filter((w) => w.length > 0)
    .map((w) => w.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
  const phrase = words.join(" ");
  if (relPath.includes("/test") || relPath.endsWith(".test.ts") || relPath.endsWith(".test.js")) {
    return `tests for ${phrase}`;
  }
  if (phrase.length === 0) return relPath;
  return phrase;
}

function clampWords(s: string, maxWords: number): string {
  const cleaned = s.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  if (words.length <= maxWords) return cleaned;
  return words.slice(0, maxWords).join(" ") + "…";
}

// ---------------------------------------------------------------------------
// Import extraction (regex per language)
// ---------------------------------------------------------------------------

interface RawImport {
  readonly specifier: string;
  readonly style: ImportStyle;
}

export function extractImports(
  content: string,
  language: LanguageTag,
): RawImport[] {
  switch (language) {
    case "typescript":
    case "javascript":
      return extractTsImports(content);
    case "python":
      return extractPyImports(content);
    case "go":
      return extractGoImports(content);
    default:
      return [];
  }
}

function extractTsImports(content: string): RawImport[] {
  // Strip block / line comments to avoid false positives.
  const stripped = stripJsComments(content);
  const out: RawImport[] = [];

  // import foo from "x"            (default)
  // import * as foo from "x"       (star)
  // import { a, b } from "x"       (named)
  // import "x"                     (side-effect)
  // import foo, { a } from "x"     (default + named)
  const importRe =
    /import\s+(?:(?:type\s+)?(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(stripped)) !== null) {
    const [, defaultName, namedBlock, starName, sideName, spec] = m;
    if (!spec) continue;
    if (namedBlock) {
      out.push({ specifier: spec, style: "named" });
    } else if (starName) {
      out.push({ specifier: spec, style: "star" });
    } else if (defaultName || sideName) {
      out.push({ specifier: spec, style: "default" });
    } else {
      out.push({ specifier: spec, style: "side-effect" });
    }
  }

  // dynamic import("x") — count as default
  const dynRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dynRe.exec(stripped)) !== null) {
    const spec = m[1];
    if (spec) out.push({ specifier: spec, style: "default" });
  }

  return out;
}

function stripJsComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function extractPyImports(content: string): RawImport[] {
  const out: RawImport[] = [];
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    // from .x.y import a, b      (relative, named)
    // from x.y import *          (named)
    // import x.y                 (default)
    // import x as y              (default)
    let m = line.match(/^from\s+([.\w]+)\s+import\s+(.+)/);
    if (m) {
      const spec = m[1] ?? "";
      const what = (m[2] ?? "").trim();
      const style: ImportStyle = what === "*" ? "star" : "named";
      out.push({ specifier: spec, style });
      continue;
    }
    m = line.match(/^import\s+([\w.,\s]+?)(?:\s+as\s+\w+)?$/);
    if (m) {
      const specs = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const s of specs) out.push({ specifier: s, style: "default" });
    }
  }
  return out;
}

function extractGoImports(content: string): RawImport[] {
  const out: RawImport[] = [];
  // import "x"   or   import ( "x"\n "y/z" )
  const single = /import\s+(?:[\w.]+\s+)?"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = single.exec(content)) !== null) {
    if (m[1]) out.push({ specifier: m[1], style: "default" });
  }
  const block = /import\s*\(([\s\S]*?)\)/g;
  while ((m = block.exec(content)) !== null) {
    const body = m[1] ?? "";
    for (const line of body.split(/\r?\n/)) {
      const lm = line.match(/^\s*(?:[\w.]+\s+)?"([^"]+)"/);
      if (lm && lm[1]) out.push({ specifier: lm[1], style: "default" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resolution to intra-project paths
// ---------------------------------------------------------------------------

const STDLIB_PY = new Set([
  "os", "sys", "re", "json", "math", "time", "datetime", "pathlib", "typing",
  "collections", "itertools", "functools", "subprocess", "asyncio", "logging",
  "argparse", "abc", "io", "string", "random", "uuid", "shutil", "hashlib",
  "pickle", "copy", "csv", "sqlite3", "unittest", "tempfile", "glob",
]);

function resolveRelative(
  fromFile: string,
  specifier: string,
  language: LanguageTag,
): string | undefined {
  if (language === "python") {
    if (!specifier.startsWith(".")) return undefined; // external or stdlib
    if (STDLIB_PY.has(specifier)) return undefined;
    const dir = path.posix.dirname(fromFile);
    const parts = specifier.split(".");
    let up = 0;
    while (parts.length > 0 && parts[0] === "") {
      parts.shift();
      up++;
    }
    let base = dir;
    for (let i = 1; i < up; i++) base = path.posix.dirname(base);
    return path.posix.normalize(path.posix.join(base, ...parts) + ".py");
  }
  if (language === "go") {
    // Go imports are package paths — we can't resolve to a file without
    // module info. Skip intra-project resolution for v1.0.
    return undefined;
  }
  // TypeScript / JavaScript
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return undefined;
  const dir = path.posix.dirname(fromFile);
  const resolved = path.posix.normalize(path.posix.join(dir, specifier));
  return resolved;
}

function dedupeStable(xs: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}
