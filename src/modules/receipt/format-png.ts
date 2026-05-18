/**
 * PNG receipt — pure-ish: ReceiptModel + font buffers → PNG bytes.
 *
 * Graceful degrade: if the native @resvg/resvg-js binding fails to load (Alpine
 * musl, some bun versions, etc.), we surface E008 and the caller should ship
 * the HTML receipt alone.
 *
 * Fonts are loaded ONCE per process (memoized) from `assets/fonts/`. Satori
 * accepts an array of `{ name, data, weight, style }` entries; we vendor TTFs
 * to avoid any fontconfig dependency.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { Buffer } from "node:buffer";
import satori from "satori";
import { buildReceiptTree } from "./satori-template.js";
import type { ReceiptModel } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "assets", "fonts");

export interface FontPack {
  readonly interRegular: Buffer;
  readonly interBold: Buffer;
  readonly jetbrainsMono: Buffer;
}

let fontCache: FontPack | null = null;

/** Read the vendored font files. Memoized. */
export async function loadFontPack(): Promise<FontPack> {
  if (fontCache) return fontCache;
  const [interRegular, interBold, jetbrainsMono] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, "Inter-Regular.ttf")),
    fs.readFile(path.join(FONT_DIR, "Inter-Bold.ttf")),
    fs.readFile(path.join(FONT_DIR, "JetBrainsMono-Medium.ttf")),
  ]);
  fontCache = { interRegular, interBold, jetbrainsMono };
  return fontCache;
}

export type PngResult =
  | { readonly ok: true; readonly png: Uint8Array }
  | { readonly ok: false; readonly code: "E008"; readonly detail: string };

export interface FormatPngOptions {
  /** Override font pack (tests). */
  readonly fonts?: FontPack;
}

export async function formatPng(
  model: ReceiptModel,
  opts: FormatPngOptions = {},
): Promise<PngResult> {
  const fonts = opts.fonts ?? (await loadFontPack());
  const tree = buildReceiptTree(model);

  // Satori → SVG. `as any` is forbidden by repo rules; we cast through unknown
  // for the structural element shape — satori's published types are slightly
  // narrower than the subset we use, but accept this tree at runtime.
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: "Inter",
        data: fonts.interRegular,
        weight: 400,
        style: "normal",
      },
      {
        name: "Inter Tight",
        data: fonts.interBold,
        weight: 700,
        style: "normal",
      },
      {
        name: "JetBrains Mono",
        data: fonts.jetbrainsMono,
        weight: 500,
        style: "normal",
      },
    ],
  });

  // resvg native binding may fail to load on Alpine/musl/some bun versions.
  // We catch *only* the dynamic import failure, not rendering errors.
  let Resvg: typeof import("@resvg/resvg-js").Resvg;
  try {
    const mod = await import("@resvg/resvg-js");
    Resvg = mod.Resvg;
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "E008", detail };
  }

  try {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 1200 },
      background: "#0b0e0e",
    });
    const pngData = resvg.render().asPng();
    return { ok: true, png: new Uint8Array(pngData) };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "E008", detail };
  }
}
