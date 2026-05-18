import { describe, expect, it } from "vitest";
import { detectPatterns } from "../../../src/modules/manifest/patterns.js";
import type {
  ParsedFile,
  ScannedFile,
} from "../../../src/modules/manifest/types.js";

const parsed = (path: string, styles: ParsedFile["importStyles"]): ParsedFile => ({
  path,
  language: "typescript",
  purpose: "",
  imports: [],
  importStyles: styles,
});

const scanned = (path: string, ext = "ts"): ScannedFile => ({
  path,
  ext,
  size: 100,
  language: "typescript",
});

describe("detectPatterns — importStyle", () => {
  it("returns 'named' when 60%+ named", () => {
    const p = detectPatterns({
      parsed: [parsed("a.ts", ["named", "named", "named", "default"])],
      scanned: [scanned("a.ts")],
      packageJson: undefined,
      hasFile: () => false,
    });
    expect(p.importStyle).toBe("named");
  });

  it("returns 'mixed' when no clear majority", () => {
    const p = detectPatterns({
      parsed: [parsed("a.ts", ["named", "default", "star"])],
      scanned: [scanned("a.ts")],
      packageJson: undefined,
      hasFile: () => false,
    });
    expect(p.importStyle).toBe("mixed");
  });

  it("returns 'unknown' when nothing parsed", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [],
      packageJson: undefined,
      hasFile: () => false,
    });
    expect(p.importStyle).toBe("unknown");
  });
});

describe("detectPatterns — testFramework", () => {
  it("detects vitest from devDependencies", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [],
      packageJson: { devDependencies: { vitest: "^2.0.0" } },
      hasFile: () => false,
    });
    expect(p.testFramework).toBe("vitest");
  });

  it("detects pytest from filename heuristic", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [scanned("tests/test_thing.py", "py")],
      packageJson: undefined,
      hasFile: () => false,
    });
    expect(p.testFramework).toBe("pytest");
  });
});

describe("detectPatterns — packageManager", () => {
  it("prefers packageManager field", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [],
      packageJson: { packageManager: "pnpm@9.0.0" },
      hasFile: () => false,
    });
    expect(p.packageManager).toBe("pnpm");
  });

  it("falls back to lockfile detection", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [],
      packageJson: undefined,
      hasFile: (f) => f === "package-lock.json",
    });
    expect(p.packageManager).toBe("npm");
  });
});

describe("detectPatterns — monorepo", () => {
  it("recognizes turbo.json", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [],
      packageJson: {},
      hasFile: (f) => f === "turbo.json",
    });
    expect(p.monorepo).toBe("turbo");
  });

  it("recognizes pnpm-workspace.yaml", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [],
      packageJson: {},
      hasFile: (f) => f === "pnpm-workspace.yaml",
    });
    expect(p.monorepo).toBe("pnpm-workspace");
  });

  it("defaults to single", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [],
      packageJson: {},
      hasFile: () => false,
    });
    expect(p.monorepo).toBe("single");
  });
});

describe("detectPatterns — naming", () => {
  it("detects kebab-case majority", () => {
    const p = detectPatterns({
      parsed: [],
      scanned: [
        scanned("src/cool-thing.ts"),
        scanned("src/other-name.ts"),
        scanned("src/third-one.ts"),
      ],
      packageJson: undefined,
      hasFile: () => false,
    });
    expect(p.naming).toBe("kebab-case");
  });
});
