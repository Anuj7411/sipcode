import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScoreCmd } from "../../src/commands/score.js";
import { FakeClock } from "../../src/lib/clock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../fixtures/repos");

const NOW = new Date("2026-05-19T12:00:00.000Z");

interface Harness {
  out: string[];
  err: string[];
  files: Map<string, string>;
}

function makeDeps(): {
  harness: Harness;
  deps: Parameters<typeof runScoreCmd>[1];
} {
  const harness: Harness = { out: [], err: [], files: new Map() };
  return {
    harness,
    deps: {
      clock: new FakeClock(NOW),
      stdout: (s: string) => harness.out.push(s),
      stderr: (s: string) => harness.err.push(s),
      writeFile: async (p: string, c: string) => {
        harness.files.set(path.normalize(p), c);
      },
      version: "0.2.0-test",
    },
  };
}

describe("runScoreCmd integration", () => {
  it("scores the excellent fixture as platinum", async () => {
    const { harness, deps } = makeDeps();
    const result = await runScoreCmd(
      { json: true, cwd: path.join(FIXTURES, "excellent") },
      deps,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(harness.out.join("\n"));
    expect(parsed.tier).toBe("platinum");
    expect(parsed.score).toBeGreaterThanOrEqual(95);
  });

  it("scores the average fixture as silver or gold", async () => {
    const { harness, deps } = makeDeps();
    const result = await runScoreCmd(
      { json: true, cwd: path.join(FIXTURES, "average") },
      deps,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(harness.out.join("\n"));
    expect(["silver", "gold"]).toContain(parsed.tier);
  });

  it("scores the poor fixture as bronze or needs-work", async () => {
    const { harness, deps } = makeDeps();
    const result = await runScoreCmd(
      { json: true, cwd: path.join(FIXTURES, "poor") },
      deps,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(harness.out.join("\n"));
    expect(["bronze", "needs-work"]).toContain(parsed.tier);
  });

  it("--threshold 95 exits 1 on the poor fixture", async () => {
    const { deps } = makeDeps();
    const result = await runScoreCmd(
      { json: true, threshold: 95, cwd: path.join(FIXTURES, "poor") },
      deps,
    );
    expect(result.exitCode).toBe(1);
  });

  it("--threshold 95 exits 0 on the excellent fixture", async () => {
    const { deps } = makeDeps();
    const result = await runScoreCmd(
      { json: true, threshold: 95, cwd: path.join(FIXTURES, "excellent") },
      deps,
    );
    expect(result.exitCode).toBe(0);
  });

  it("rejects a non-numeric threshold", async () => {
    const { harness, deps } = makeDeps();
    const result = await runScoreCmd(
      { threshold: "abc", cwd: path.join(FIXTURES, "excellent") },
      deps,
    );
    expect(result.exitCode).toBe(1);
    expect(harness.err.join("\n")).toMatch(/threshold|E0\d\d/i);
  });

  it("--json --badge writes a valid Shields.io endpoint JSON", async () => {
    const { harness, deps } = makeDeps();
    const result = await runScoreCmd(
      { json: true, badge: true, cwd: path.join(FIXTURES, "excellent") },
      deps,
    );
    expect(result.exitCode).toBe(0);
    const badgePath = path.normalize(
      path.join(FIXTURES, "excellent", ".sipcode", "badge.json"),
    );
    const badge = JSON.parse(harness.files.get(badgePath)!);
    expect(badge.schemaVersion).toBe(1);
    expect(badge.label).toBe("sipcode");
    expect(badge.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("writes an HTML report by default; --no-html suppresses it", async () => {
    const { harness, deps } = makeDeps();
    await runScoreCmd({ cwd: path.join(FIXTURES, "excellent") }, deps);
    const htmlPath = path.normalize(
      path.join(FIXTURES, "excellent", ".sipcode", "score.html"),
    );
    expect(harness.files.has(htmlPath)).toBe(true);

    const { harness: h2, deps: d2 } = makeDeps();
    await runScoreCmd(
      { html: false, cwd: path.join(FIXTURES, "excellent") },
      d2,
    );
    expect(h2.files.has(htmlPath)).toBe(false);
  });

  it("produces byte-identical JSON, HTML, badge across runs (idempotence)", async () => {
    const a = makeDeps();
    const b = makeDeps();
    await runScoreCmd(
      {
        json: false,
        html: true,
        badge: true,
        cwd: path.join(FIXTURES, "excellent"),
      },
      a.deps,
    );
    await runScoreCmd(
      {
        json: false,
        html: true,
        badge: true,
        cwd: path.join(FIXTURES, "excellent"),
      },
      b.deps,
    );
    const htmlPath = path.normalize(
      path.join(FIXTURES, "excellent", ".sipcode", "score.html"),
    );
    const badgePath = path.normalize(
      path.join(FIXTURES, "excellent", ".sipcode", "badge.json"),
    );
    expect(a.harness.files.get(htmlPath)).toBe(b.harness.files.get(htmlPath));
    expect(a.harness.files.get(badgePath)).toBe(b.harness.files.get(badgePath));
  });

  it("JSON envelope shape is stable: top-level keys are fixed", async () => {
    const { harness, deps } = makeDeps();
    await runScoreCmd(
      { json: true, cwd: path.join(FIXTURES, "excellent") },
      deps,
    );
    const parsed = JSON.parse(harness.out.join("\n"));
    expect(Object.keys(parsed).sort()).toEqual([
      "categories",
      "checks",
      "metaGenerator",
      "project",
      "recommendations",
      "schemaVersion",
      "score",
      "tier",
    ]);
  });
});
