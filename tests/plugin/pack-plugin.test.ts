/**
 * scripts/pack-plugin.mjs builds the plugin directory ZIP. The archive must hold
 * exactly the skills-only package (manifests, skills, assets, README, LICENSE),
 * at the archive root, with forward-slash names, and each entry must unpack to
 * the bytes of its source file.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
// @ts-ignore plain .mjs script without type declarations (tests are not type-checked by lint)
import { ALLOWED, crc32, pack, zipEntryNames } from "../../scripts/pack-plugin.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLUGIN = path.join(ROOT, "plugins", "sipcode");
const version = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8")) as { version: string }).version;

/** Entry name -> unpacked bytes, read through the central directory. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const n = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 46, p + 46 + n).toString("utf-8");
    const local = buf.readUInt32LE(p + 42);
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(crc32(data), name).toBe(crc);
    out.set(name, data);
    p += 46 + n + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

describe("plugin directory ZIP (scripts/pack-plugin.mjs)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sipcode-pack-"));
  const result = pack(dir) as { out: string; bytes: number };
  const buf = readFileSync(result.out);
  const names = zipEntryNames(buf) as string[];

  it("is named after the package version", () => {
    expect(path.basename(result.out)).toBe(`sipcode-plugin-${version}.zip`);
    expect(buf.length).toBe(result.bytes);
  });

  it("holds exactly the skills-only package at the archive root", () => {
    expect(names).toEqual([
      ".codex-plugin/plugin.json",
      "LICENSE",
      "README.md",
      "assets/logo.png",
      "plugin.json",
      "skills/sipcode-limits/SKILL.md",
      "skills/sipcode-regress/SKILL.md",
      "skills/sipcode-spend/SKILL.md",
      "skills/sipcode-why/SKILL.md",
    ]);
    for (const n of names) {
      expect((ALLOWED as RegExp[]).some((re) => re.test(n)), n).toBe(true);
      expect(n).not.toMatch(/\\|^\/|\.\.|^(tests|src|\.github|node_modules|dist)\//);
      expect(n).not.toMatch(/(^|\/)(\.?mcp\.json|\.app\.json|hooks\/)/);
    }
  });

  it("every entry unpacks to its source bytes", () => {
    const files = unzip(buf);
    for (const [name, data] of files) {
      const src = name === "LICENSE" ? path.join(ROOT, "LICENSE") : path.join(PLUGIN, ...name.split("/"));
      expect(data.equals(readFileSync(src)), name).toBe(true);
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
