/**
 * Lightweight CodebaseSnapshot builder for check unit tests.
 *
 * Skips the real I/O / parser path entirely: lets each test compose a
 * targeted shape without touching disk.
 */
import type {
  CodebaseSnapshot,
} from "../../../src/modules/score/types.js";
import type {
  DetectedPatterns,
  FrameworkFingerprint,
  ScannedFile,
  LanguageTag,
} from "../../../src/modules/manifest/types.js";

const DEFAULT_PATTERNS: DetectedPatterns = {
  importStyle: "named",
  naming: "kebab-case",
  testFramework: "vitest",
  packageManager: "npm",
  monorepo: "single",
};

const DEFAULT_FRAMEWORK: FrameworkFingerprint = {
  framework: "library",
  buildTool: "tsc",
};

function classifyLang(ext: string): LanguageTag {
  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    default:
      return "other";
  }
}

export interface SyntheticInput {
  /** path -> { lineCount, firstLineComment } */
  readonly files?: ReadonlyArray<{
    path: string;
    lineCount?: number;
    firstLineComment?: string;
  }>;
  readonly claudeMd?: string;
  readonly readme?: string;
  readonly agentsMd?: string;
  readonly cursorRules?: string;
  readonly sipcodeManifest?: string;
  readonly packageJson?: unknown;
  readonly pyprojectToml?: string;
  readonly goMod?: string;
  readonly patterns?: Partial<DetectedPatterns>;
  readonly framework?: Partial<FrameworkFingerprint>;
  readonly projectName?: string;
}

export function buildSyntheticSnapshot(input: SyntheticInput): CodebaseSnapshot {
  const scanned: ScannedFile[] = [];
  const lineCounts = new Map<string, number>();
  const firstLineComment = new Map<string, string | undefined>();
  for (const f of input.files ?? []) {
    const ext = (f.path.split(".").pop() ?? "").toLowerCase();
    const lang = classifyLang(ext);
    scanned.push({ path: f.path, ext, size: 100, language: lang });
    if (f.lineCount !== undefined) lineCounts.set(f.path, f.lineCount);
    firstLineComment.set(f.path, f.firstLineComment);
  }
  const fileIndex = new Map<string, ScannedFile>();
  for (const s of scanned) fileIndex.set(s.path, s);
  return {
    projectRoot: "/proj",
    projectName: input.projectName ?? "synthetic",
    scanned,
    fileIndex,
    hasFile: (rel: string) => fileIndex.has(rel),
    claudeMd: input.claudeMd,
    readme: input.readme,
    agentsMd: input.agentsMd,
    cursorRules: input.cursorRules,
    sipcodeManifest: input.sipcodeManifest,
    packageJson: input.packageJson,
    pyprojectToml: input.pyprojectToml,
    goMod: input.goMod,
    parsed: [],
    patterns: { ...DEFAULT_PATTERNS, ...(input.patterns ?? {}) },
    framework: { ...DEFAULT_FRAMEWORK, ...(input.framework ?? {}) },
    lineCounts,
    firstLineComment,
  };
}
