import { describe, expect, it } from "vitest";
import { renderWithBudget } from "../../../src/modules/manifest/budget.js";
import type { ManifestInputs } from "../../../src/modules/manifest/types.js";

function smallInputs(): ManifestInputs {
  return {
    projectName: "tiny",
    projectRoot: "/x",
    headShort: "aaaa111",
    generatedAt: "HEAD@aaaa111",
    files: [{ path: "src/a.ts", ext: "ts", size: 10, language: "typescript" }],
    parsed: [
      {
        path: "src/a.ts",
        language: "typescript",
        purpose: "tiny",
        imports: [],
        importStyles: [],
      },
    ],
    importGraph: { edges: new Map() },
    hotFiles: [],
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
  };
}

function bloatedInputs(): ManifestInputs {
  // 200 files, each with imports — should push past 2000 tokens.
  const files = Array.from({ length: 200 }, (_, i) => ({
    path: `src/m${String(i).padStart(3, "0")}/file-with-long-name-${i}.ts`,
    ext: "ts",
    size: 100,
    language: "typescript" as const,
  }));
  const parsed = files.map((f, i) => ({
    path: f.path,
    language: "typescript" as const,
    purpose: `the file does a very specific thing number ${i}`,
    imports: files
      .slice(Math.max(0, i - 5), i)
      .map((x) => x.path),
    importStyles: [] as ReadonlyArray<"named">,
  }));
  const edges = new Map<string, ReadonlyArray<string>>();
  for (const p of parsed) edges.set(p.path, p.imports.slice(0, 5));
  return {
    projectName: "bloated",
    projectRoot: "/x",
    headShort: "bbbb222",
    generatedAt: "HEAD@bbbb222",
    files,
    parsed,
    importGraph: { edges },
    hotFiles: files.slice(0, 20).map((f, i) => ({ path: f.path, changes: 20 - i })),
    patterns: {
      importStyle: "named",
      naming: "kebab-case",
      testFramework: "vitest",
      packageManager: "npm",
      monorepo: "single",
    },
    framework: {
      framework: "library",
      buildTool: "tsc",
      languages: ["typescript"],
    },
    issues: [],
  };
}

describe("renderWithBudget", () => {
  it("returns ok with no tightening for small projects", () => {
    const r = renderWithBudget(smallInputs());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tightened).toBe(false);
      expect(r.value.rendered.tokenCount).toBeLessThan(2000);
    }
  });

  it("returns E001 when over budget without --tighten", () => {
    const r = renderWithBudget(bloatedInputs());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error[0]?.code).toBe("E001");
      expect(r.error[0]?.message).toMatch(/over the/);
    }
  });

  it("tightens by dropping sections when over budget", () => {
    const r = renderWithBudget(bloatedInputs(), { tighten: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tightened).toBe(true);
      expect(r.value.rendered.tokenCount).toBeLessThanOrEqual(2000);
    }
  });

  it("respects --no-budget (enforce=false)", () => {
    const r = renderWithBudget(bloatedInputs(), { enforce: false });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Did not tighten because we didn't enforce.
      expect(r.value.tightened).toBe(false);
    }
  });
});
