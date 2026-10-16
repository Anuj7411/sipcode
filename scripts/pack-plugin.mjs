/**
 * Builds the ZIP for the OpenAI plugin directory (shared by ChatGPT and Codex):
 *
 *   node scripts/pack-plugin.mjs [--out <dir>]
 *
 * writes <dir>/sipcode-plugin-<version>.zip (default dir: dist-plugin/).
 *
 * Layout (developers.openai.com/plugins/deploy/submission and
 * /plugins/deploy/submission-errors): one plugin root at the archive root,
 * holding the portable manifest `plugin.json`, the Codex overlay
 * `.codex-plugin/plugin.json`, `skills/<name>/SKILL.md`, `assets/`, plus
 * README.md and LICENSE. Skills only: no hooks, no MCP configuration, no apps,
 * no screenshots (a skills-only upload rejects all four). Nothing from tests/,
 * .github/ or src/.
 *
 * The ZIP is written here with node:zlib (deflate) and a small CRC-32, so it
 * needs no dependency and every entry name uses forward slashes. Entries are
 * sorted and carry a fixed timestamp, so the same inputs give the same bytes.
 */
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(ROOT, "plugins", "sipcode");

/** What a skills-only directory package may contain, relative to the plugin root. */
export const ALLOWED = [
  /^plugin\.json$/,
  /^\.codex-plugin\/plugin\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^assets\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|svg)$/,
  /^skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/,
];

/** Files a skills-only upload rejects (hooks, MCP servers, apps). */
const FORBIDDEN = [/^hooks\//, /(^|\/)\.?mcp\.json$/, /(^|\/)\.app\.json$/];

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}

/**
 * The package contents: [{ name, source }], sorted by name. Throws when the
 * plugin folder holds anything outside ALLOWED, when the manifest version is
 * not the npm package version, or when a manifest points at a missing file.
 */
export function packageFiles() {
  const files = walk(PLUGIN).map((name) => ({ name, source: path.join(PLUGIN, ...name.split("/")) }));
  files.push({ name: "LICENSE", source: path.join(ROOT, "LICENSE") });

  for (const { name } of files) {
    if (FORBIDDEN.some((re) => re.test(name))) throw new Error(`not allowed in a skills-only package: ${name}`);
    if (!ALLOWED.some((re) => re.test(name))) throw new Error(`unexpected file in plugins/sipcode: ${name}`);
  }

  const manifest = JSON.parse(readFileSync(path.join(PLUGIN, "plugin.json"), "utf-8"));
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  if (manifest.version !== pkg.version) {
    throw new Error(`plugin.json version ${manifest.version} is not package.json version ${pkg.version}`);
  }
  const openai = manifest.extensions?.["com.openai"] ?? {};
  const iface = openai.interface ?? {};
  if (iface.screenshots) throw new Error("interface.screenshots is rejected for skills-only uploads");
  for (const k of ["hooks", "apps", "mcpServers"]) if (openai[k]) throw new Error(`extensions.com.openai.${k} is not allowed`);
  const names = new Set(files.map((f) => f.name));
  for (const k of ["logo", "composerIcon", "logoDark", "composerIconDark"]) {
    if (!iface[k]) continue;
    if (!iface[k].startsWith("./")) throw new Error(`${k} must start with ./`);
    if (!names.has(iface[k].slice(2))) throw new Error(`${k} points at a missing file: ${iface[k]}`);
  }
  if (!files.some((f) => f.name.startsWith("skills/"))) throw new Error("no skills");

  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fixed MS-DOS timestamp: 2026-01-01 00:00:00.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** A ZIP (deflate, UTF-8 names) of [{ name, data }]. */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf-8");
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Entry names from a ZIP's central directory (for checks and tests). */
export function zipEntryNames(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const n = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + n).toString("utf-8"));
    p += 46 + n + extra + comment;
  }
  return names;
}

export function pack(outDir = path.join(ROOT, "dist-plugin")) {
  const files = packageFiles();
  const { version } = JSON.parse(readFileSync(path.join(PLUGIN, "plugin.json"), "utf-8"));
  const buf = zip(files.map(({ name, source }) => ({ name, data: readFileSync(source) })));
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `sipcode-plugin-${version}.zip`);
  writeFileSync(out, buf);
  return { out, files: files.map((f) => ({ name: f.name, bytes: statSync(f.source).size })), bytes: buf.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--out");
  const outDir = i > 0 ? path.resolve(process.argv[i + 1]) : undefined;
  const { out, files, bytes } = pack(outDir);
  for (const f of files) console.log(`  ${f.name}  (${f.bytes} bytes)`);
  console.log(`${path.relative(process.cwd(), out)}: ${files.length} files, ${bytes} bytes`);
}
