import { describe, expect, it } from "vitest";
import { detectFramework } from "../../../src/modules/manifest/framework.js";
import type { ScannedFile } from "../../../src/modules/manifest/types.js";

const sc = (path: string, ext: string, lang: ScannedFile["language"]): ScannedFile => ({
  path,
  ext,
  size: 1,
  language: lang,
});

describe("detectFramework", () => {
  it("detects next-app when app/layout.tsx present", () => {
    const f = detectFramework({
      packageJson: { dependencies: { next: "^14" } },
      hasFile: (p) => p === "app/layout.tsx",
      scanned: [sc("app/layout.tsx", "tsx", "typescript")],
    });
    expect(f.framework).toBe("next-app");
  });

  it("falls back to next-pages when next present but no app dir", () => {
    const f = detectFramework({
      packageJson: { dependencies: { next: "^14" } },
      hasFile: () => false,
      scanned: [],
    });
    expect(f.framework).toBe("next-pages");
  });

  it("detects astro", () => {
    const f = detectFramework({
      packageJson: { dependencies: { astro: "^4" } },
      hasFile: () => false,
      scanned: [],
    });
    expect(f.framework).toBe("astro");
  });

  it("detects CLI when package has bin", () => {
    const f = detectFramework({
      packageJson: { bin: { mycli: "./cli.js" } },
      hasFile: () => false,
      scanned: [],
    });
    expect(f.framework).toBe("cli");
  });

  it("detects build tool tsc fallback", () => {
    const f = detectFramework({
      packageJson: { devDependencies: { typescript: "^5" } },
      hasFile: () => false,
      scanned: [],
    });
    expect(f.buildTool).toBe("tsc");
  });

  it("collects languages in stable order", () => {
    const f = detectFramework({
      packageJson: {},
      hasFile: () => false,
      scanned: [
        sc("a.py", "py", "python"),
        sc("b.ts", "ts", "typescript"),
        sc("c.go", "go", "go"),
      ],
    });
    expect(f.languages).toEqual(["typescript", "python", "go"]);
  });

  it("returns unknown for empty input", () => {
    const f = detectFramework({
      packageJson: undefined,
      hasFile: () => false,
      scanned: [],
    });
    expect(f.framework).toBe("unknown");
    expect(f.languages).toEqual([]);
  });
});
