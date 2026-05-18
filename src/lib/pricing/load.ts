/**
 * Pricing loader. Pure — takes a Clock, returns the latest pricing file ≤ session date.
 *
 * Pricing files are bundled JSON under src/lib/pricing/<YYYY-MM-DD>.json.
 * v0.1.0-alpha.1 ships exactly one. The loader is forward-compatible.
 */
import { z } from "zod";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PriceRowSchema = z.object({
  input_per_mtok: z.number(),
  output_per_mtok: z.number(),
  cache_read_per_mtok: z.number(),
  cache_creation_per_mtok: z.number(),
});

const PricingFileSchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_url: z.string(),
  models: z.record(PriceRowSchema),
});

export type PricingFile = z.infer<typeof PricingFileSchema>;
export type PriceRow = z.infer<typeof PriceRowSchema>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Return all bundled pricing files, sorted by date asc. Reads disk once. */
function listBundledPricingFiles(): { date: string; absPath: string }[] {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  return files
    .map((f) => ({ date: f.replace(/\.json$/, ""), absPath: path.join(dir, f) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Returns the latest pricing file dated ≤ sessionDate. Falls back to oldest
 * available file if session predates all bundled prices.
 */
export function loadPricingForDate(sessionDate: Date): PricingFile {
  const files = listBundledPricingFiles();
  if (files.length === 0) {
    throw new Error("no pricing files bundled with sipcode");
  }
  const iso = sessionDate.toISOString().slice(0, 10);
  let chosen = files[0]!;
  for (const f of files) {
    if (f.date <= iso) chosen = f;
  }
  const raw = JSON.parse(readFileSync(chosen.absPath, "utf-8")) as unknown;
  return PricingFileSchema.parse(raw);
}

/**
 * Days between today and the pricing file. Negative if pricing is in future.
 */
export function pricingAgeDays(pricing: PricingFile, now: Date): number {
  const pricingDate = new Date(pricing.as_of + "T00:00:00Z").getTime();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).getTime();
  return Math.floor((today - pricingDate) / (1000 * 60 * 60 * 24));
}

const MODEL_ALIASES: Record<string, string> = {
  // Internal/dotted Claude Code model names → canonical pricing keys.
  "claude-opus-4-7": "claude-opus-4",
  "claude-opus-4-6": "claude-opus-4",
  "claude-opus-4-5": "claude-opus-4",
  "claude-opus-4-0": "claude-opus-4",
  "claude-opus-4": "claude-opus-4",
  "claude-sonnet-4-7": "claude-sonnet-4",
  "claude-sonnet-4-5": "claude-sonnet-4",
  "claude-sonnet-4-0": "claude-sonnet-4",
  "claude-sonnet-4": "claude-sonnet-4",
  "claude-haiku-4-5": "claude-haiku-4",
  "claude-haiku-4": "claude-haiku-4",
};

export function priceForModel(
  pricing: PricingFile,
  model: string,
): PriceRow | undefined {
  const direct = pricing.models[model];
  if (direct) return direct;
  const alias = MODEL_ALIASES[model];
  if (alias && pricing.models[alias]) return pricing.models[alias];
  // Loose match: try prefix.
  for (const key of Object.keys(pricing.models)) {
    if (model.startsWith(key)) return pricing.models[key];
  }
  return undefined;
}

export const PRICING_SCHEMA = PricingFileSchema;
