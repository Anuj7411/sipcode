import { describe, expect, it } from "vitest";
import { renderManifest } from "../../../src/modules/manifest/render.js";
import type {
  ManifestInputs,
} from "../../../src/modules/manifest/types.js";

const baseInputs = (): ManifestInputs => ({
  projectName: "demo",
  projectRoot: "/x",
  headShort: "abc1234",
  generatedAt: "HEAD@abc1234",
  files: [
    { path: "src/a.ts", ext: "ts", size: 100, language: "typescript" },
    { path: "src/b.ts", ext: "ts", size: 100, language: "typescript" },
  ],
  parsed: [
    {
      path: "src/a.ts",
      language: "typescript",
      purpose: "alpha thing",
      imports: ["src/b.ts"],
      importStyles: ["named"],
    },
    {
      path: "src/b.ts",
      language: "typescript",
      purpose: "beta thing",
      imports: [],
      importStyles: [],
    },
  ],
  importGraph: { edges: new Map([["src/a.ts", ["src/b.ts"]]]) },
  hotFiles: [{ path: "src/a.ts", changes: 5 }],
  patterns: {
    importStyle: "named",
    naming: "kebab-case",
    testFramework: "vitest",
    packageManager: "npm",
    monorepo: "single",
  },
  framework: {
    framework: "cli",
    buildTool: "tsc",
    languages: ["typescript"],
  },
  issues: [],
});

describe("renderManifest", () => {
  it("includes all section headings by default", () => {
    const r = renderManifest(baseInputs());
    expect(r.content).toContain("# Project manifest");
    expect(r.content).toContain("## Framework");
    expect(r.content).toContain("## Detected patterns");
    expect(r.content).toContain("## File tree");
    expect(r.content).toContain("## Hot files");
    expect(r.content).toContain("## Import graph");
  });

  it("renders POSIX paths only", () => {
    const r = renderManifest(baseInputs());
    expect(r.content).not.toMatch(/\\/);
  });

  it("returns a positive token count", () => {
    const r = renderManifest(baseInputs());
    expect(r.tokenCount).toBeGreaterThan(0);
  });

  it("is byte-identical across two runs with same inputs", () => {
    const i = baseInputs();
    const a = renderManifest(i).content;
    const b = renderManifest(i).content;
    expect(a).toBe(b);
  });

  it("omits hotFiles section when list is empty", () => {
    const i = { ...baseInputs(), hotFiles: [] };
    const r = renderManifest(i);
    expect(r.content).not.toContain("## Hot files");
  });

  it("can drop sections via options", () => {
    const r = renderManifest(baseInputs(), {
      sections: ["header", "framework"],
    });
    expect(r.content).toContain("## Framework");
    expect(r.content).not.toContain("## Detected patterns");
    expect(r.content).not.toContain("## File tree");
  });

  it("includes the git head and project name in header", () => {
    const r = renderManifest(baseInputs());
    expect(r.content).toContain("demo");
    expect(r.content).toContain("abc1234");
  });

  it("compactFileTree drops per-file purpose lines", () => {
    const full = renderManifest(baseInputs());
    const compact = renderManifest(baseInputs(), { compactFileTree: true });
    expect(full.content).toContain("alpha thing");
    expect(compact.content).not.toContain("alpha thing");
    // Both still mention the file path.
    expect(compact.content).toContain("src/a.ts");
  });

  it("filters non-source 'other' files unless allowlisted", () => {
    const i = baseInputs();
    // Add a generated json (not allowlisted) and a README.md (allowlisted).
    const files = [
      ...i.files,
      { path: "junk/x.json", ext: "json", size: 100, language: "other" as const },
      { path: "README.md", ext: "md", size: 100, language: "other" as const },
    ];
    const r = renderManifest({ ...i, files });
    expect(r.content).not.toContain("junk/x.json");
    expect(r.content).toContain("README.md");
  });
});
