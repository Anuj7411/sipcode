/**
 * test helpers — load a fixture repo into a CodebaseSnapshot via the real
 * filesystem. Keeps every score test honest about the on-disk layout.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RealFileSystem, InMemoryFs } from "../../../src/lib/fs.js";
import { buildSnapshot } from "../../../src/modules/score/snapshot.js";
import type { CodebaseSnapshot } from "../../../src/modules/score/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_ROOT = path.resolve(__dirname, "../../fixtures/repos");

export type FixtureName = "excellent" | "average" | "poor";

export async function loadFixtureSnapshot(
  name: FixtureName,
): Promise<CodebaseSnapshot> {
  const root = path.join(FIXTURES_ROOT, name);
  const fs = new RealFileSystem();
  return buildSnapshot({ fs, projectRoot: root });
}

/** Build a synthetic snapshot from an in-memory layout. */
export async function snapshotFromInMemory(layout: {
  files: Record<string, string>;
}): Promise<CodebaseSnapshot> {
  const fs = new InMemoryFs();
  const root = "/proj";
  fs.mkdir(root);
  for (const [relPath, content] of Object.entries(layout.files)) {
    fs.writeFile(path.posix.join(root, relPath), content);
  }
  return buildSnapshot({ fs, projectRoot: root });
}
