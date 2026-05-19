import { describe, expect, it } from "vitest";
import { loadFixtureSnapshot } from "./_helpers.js";

describe("buildSnapshot", () => {
  it("reads CLAUDE.md, README, AGENTS.md from the excellent fixture", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    expect(snap.claudeMd).toBeDefined();
    expect(snap.claudeMd).toContain("routing rules");
    expect(snap.agentsMd).toContain("agents manifest");
    expect(snap.readme).toContain("# excellent");
  });

  it("returns a non-empty file scan for each fixture", async () => {
    const e = await loadFixtureSnapshot("excellent");
    const a = await loadFixtureSnapshot("average");
    const p = await loadFixtureSnapshot("poor");
    expect(e.scanned.length).toBeGreaterThan(5);
    expect(a.scanned.length).toBeGreaterThan(5);
    expect(p.scanned.length).toBeGreaterThan(5);
  });

  it("populates lineCounts for source files", async () => {
    const snap = await loadFixtureSnapshot("average");
    const utils = snap.lineCounts.get("src/utils.ts");
    expect(utils).toBeDefined();
    expect(utils!).toBeGreaterThan(200);
  });

  it("detects the project name from package.json", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    expect(snap.projectName).toBe("excellent");
  });

  it("falls back to the directory basename when package.json has no name", async () => {
    const snap = await loadFixtureSnapshot("poor");
    expect(snap.projectName).toBe("poor");
  });

  it("captures first-line comments for source files", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    const c = snap.firstLineComment.get("src/cli.ts");
    expect(c).toBeDefined();
    expect(c!.startsWith("/**")).toBe(true);
  });

  it("flags poor fixture as having no CLAUDE.md", async () => {
    const snap = await loadFixtureSnapshot("poor");
    expect(snap.claudeMd).toBeUndefined();
  });

  it("captures packageJson as a parsed object", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    expect(typeof snap.packageJson).toBe("object");
    const pj = snap.packageJson as { name?: string; scripts?: unknown };
    expect(pj.name).toBe("excellent");
    expect(pj.scripts).toBeDefined();
  });

  it("hasFile returns true for known paths and false otherwise", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    expect(snap.hasFile(".gitignore")).toBe(true);
    expect(snap.hasFile("package.json")).toBe(true);
    expect(snap.hasFile("does/not/exist.ts")).toBe(false);
  });

  it("parses TS source into ParsedFile entries", async () => {
    const snap = await loadFixtureSnapshot("excellent");
    expect(snap.parsed.length).toBeGreaterThan(0);
    const cli = snap.parsed.find((p) => p.path === "src/cli.ts");
    expect(cli).toBeDefined();
  });
});
