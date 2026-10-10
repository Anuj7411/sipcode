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

const RatesSchema = z.object({
  input_per_mtok: z.number(),
  output_per_mtok: z.number(),
  cache_read_per_mtok: z.number(),
  /** 5-minute cache write. */
  cache_creation_per_mtok: z.number(),
  /** 1-hour cache write (2x input). Claude Code subscriptions use it for the main conversation. */
  cache_creation_1h_per_mtok: z.number().optional(),
});

const PriceRowSchema = RatesSchema.extend({
  /** Higher rates once a prompt exceeds `over_tokens` (e.g. Haiku 5.5 above 100K). */
  long_prompt: RatesSchema.extend({ over_tokens: z.number() }).optional(),
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

/** OpenAI (Codex) tables: openai-<YYYY-MM-DD>.json, sorted by date asc. */
function listOpenAiPricingFiles(): string[] {
  return readdirSync(__dirname)
    .filter((f) => /^openai-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => path.join(__dirname, f));
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
  const file = PricingFileSchema.parse(raw);
  // A session dated before a model's pricing file was bundled would otherwise
  // find no price and cost $0. Fill missing models from the newest table.
  const newest = files[files.length - 1]!;
  if (newest.absPath !== chosen.absPath) {
    const latest = PricingFileSchema.parse(
      JSON.parse(readFileSync(newest.absPath, "utf-8")) as unknown,
    );
    for (const [model, row] of Object.entries(latest.models)) {
      if (!file.models[model]) file.models[model] = row;
    }
  }
  // OpenAI prices are not dated: the newest openai-*.json applies to all session dates.
  // OpenAI (Codex) models live in their own table; ids never collide with claude-*.
  const openai = listOpenAiPricingFiles().at(-1);
  if (openai) {
    const table = PricingFileSchema.parse(JSON.parse(readFileSync(openai, "utf-8")) as unknown);
    for (const [model, row] of Object.entries(table.models)) {
      if (!file.models[model]) file.models[model] = row;
    }
  }
  return file;
}

/** Whose price table a session's cost comes from: Claude Code → anthropic, Codex → openai. */
export type PriceProvider = "anthropic" | "openai";

/**
 * The date of the table a provider's prices come from. `pricing.as_of` is the
 * Anthropic table's date; OpenAI rows come from the newest openai-*.json.
 */
export function pricingAsOf(pricing: PricingFile, provider: PriceProvider): string {
  if (provider === "anthropic") return pricing.as_of;
  const openai = listOpenAiPricingFiles().at(-1);
  if (!openai) return pricing.as_of;
  return PricingFileSchema.parse(JSON.parse(readFileSync(openai, "utf-8")) as unknown).as_of;
}

/**
 * The date of the NEWEST bundled table for a provider. The stale-price
 * warning (E004) keys off this, not off the table an older session is priced
 * with: an old session correctly uses an old table, which says nothing about
 * whether Sipcode's own prices are out of date.
 */
export function newestPricingAsOf(provider: PriceProvider): string {
  if (provider === "openai") {
    const openai = listOpenAiPricingFiles().at(-1);
    if (openai) {
      return PricingFileSchema.parse(JSON.parse(readFileSync(openai, "utf-8")) as unknown).as_of;
    }
  }
  const files = listBundledPricingFiles();
  if (files.length === 0) throw new Error("no pricing files bundled with sipcode");
  return files[files.length - 1]!.date;
}

/**
 * Days between today and the pricing file. Negative if pricing is in future.
 */
export function pricingAgeDays(pricing: PricingFile, now: Date): number {
  return daysSinceAsOf(pricing.as_of, now);
}

/** Days between today and a yyyy-mm-dd table date. Negative if in the future. */
export function daysSinceAsOf(asOf: string, now: Date): number {
  const pricingDate = new Date(asOf + "T00:00:00Z").getTime();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).getTime();
  return Math.floor((today - pricingDate) / (1000 * 60 * 60 * 24));
}

const MODEL_ALIASES: Record<string, string> = {
  // Only names with no table row of their own. Opus 4.5+ must NOT map to
  // claude-opus-4: Opus 4/4.1 cost $15/$75, Opus 4.5 and later $5/$25.
  "claude-opus-4-0": "claude-opus-4",
  "claude-sonnet-4-0": "claude-sonnet-4",
};

/** What may follow a table key in a snapshot id: a date only (-20251001 or -2026-03-01), never a minor version. */
const SNAPSHOT_SUFFIX = /^-(\d{8}|\d{4}-\d{2}-\d{2})$/;

export function priceForModel(
  pricing: PricingFile,
  model: string,
): PriceRow | undefined {
  const direct = pricing.models[model];
  if (direct) return direct;
  const alias = MODEL_ALIASES[model];
  if (alias && pricing.models[alias]) return pricing.models[alias];
  // Loose match for snapshot ids (claude-haiku-4-5-20251001, gpt-5.4-2026-03-01):
  // a key matches only when the rest of the id is a date, so
  // gpt-5.1-codex-mini never borrows gpt-5.1's price (unknown stays unknown).
  // The LONGEST matching key wins, so claude-opus-5-5 never falls back to claude-opus-5.
  let best: string | undefined;
  for (const key of Object.keys(pricing.models)) {
    if (model === key || (model.startsWith(key) && SNAPSHOT_SUFFIX.test(model.slice(key.length)))) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? pricing.models[best] : undefined;
}

export const PRICING_SCHEMA = PricingFileSchema;
