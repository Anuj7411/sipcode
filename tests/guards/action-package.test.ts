/**
 * The GitHub Action runs the published package by its real name, with flags
 * the score command has.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf-8");

describe("action/", () => {
  const pkg = JSON.parse(read("package.json")) as { name: string };
  const files = ["action/action.yml", "action/README.md"];

  it("runs the package under its npm name", () => {
    for (const f of files) {
      const text = read(f);
      expect(text, f).toContain(`npx --yes ${pkg.name}@latest score`);
      expect(text, f).not.toContain("@sipcode/cli");
    }
  });

  it("uses only flags the score command defines", () => {
    const cli = read("src/cli.ts");
    const score = cli.slice(cli.indexOf('.command("score")'), cli.indexOf(".action(", cli.indexOf('.command("score")')));
    const defined = new Set([...score.matchAll(/\.option\("(--[a-z-]+)/g)].map((m) => m[1]));
    for (const f of files) {
      // Every --flag in these files belongs to the score command line.
      const used = new Set([...read(f).matchAll(/(--[a-z][a-z-]*)/g)].map((m) => m[1]!).filter((x) => x !== "--yes"));
      expect(used.size, f).toBeGreaterThan(0);
      for (const flag of used) expect(defined, `${f}: ${flag}`).toContain(flag);
    }
  });
});
