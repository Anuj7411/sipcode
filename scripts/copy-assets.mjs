#!/usr/bin/env node
/**
 * Copies non-TypeScript assets from `src/` to `dist/` after `tsc`.
 *
 * Why this exists: `tsc` only compiles `.ts`. Data files (JSON pricing,
 * binary fonts) are needed at runtime but `tsc` leaves them behind.
 * Without this script the published tarball is missing:
 *   - src/lib/pricing/*.json   (every command that touches cost)
 *   - src/modules/receipt/assets/fonts/*.ttf (the receipt PNG renderer)
 *
 * Caught by the post-publish smoke test on v1.0.0 — see git history for
 * the "no pricing files bundled with sipcode" failure that prompted v1.0.1.
 */
import { readdir, mkdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Each pair = (src dir relative to repo root, matching dist dir).
const COPIES = [
  {
    from: "src/lib/pricing",
    to: "dist/lib/pricing",
    matches: (name) => name.endsWith(".json"),
  },
  {
    from: "src/modules/receipt/assets/fonts",
    to: "dist/modules/receipt/assets/fonts",
    matches: (name) => name.endsWith(".ttf") || name.endsWith(".woff2"),
  },
];

let copiedCount = 0;

for (const { from, to, matches } of COPIES) {
  const srcDir = path.join(repoRoot, from);
  const destDir = path.join(repoRoot, to);

  let entries;
  try {
    entries = await readdir(srcDir);
  } catch (e) {
    console.warn(`  skip ${from} — not a directory`);
    continue;
  }

  await mkdir(destDir, { recursive: true });

  for (const name of entries) {
    if (!matches(name)) continue;
    const srcFile = path.join(srcDir, name);
    const destFile = path.join(destDir, name);
    const s = await stat(srcFile);
    if (!s.isFile()) continue;
    await copyFile(srcFile, destFile);
    console.log(`  copy  ${from}/${name}  ->  ${to}/${name}  (${s.size} B)`);
    copiedCount += 1;
  }
}

console.log(`copy-assets: ${copiedCount} file(s) copied to dist/.`);
