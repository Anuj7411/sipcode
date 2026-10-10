import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  daysSinceAsOf,
  loadPricingForDate,
  pricingAgeDays,
  pricingAsOf,
  priceForModel,
} from "../../src/lib/pricing/load.js";

describe("pricing loader", () => {
  it("loads the 2026-05-01 file for a session on that day", () => {
    const p = loadPricingForDate(new Date("2026-05-01T00:00:00Z"));
    expect(p.as_of).toBe("2026-05-01");
    expect(p.models["claude-opus-4"]?.input_per_mtok).toBe(15);
  });

  it("falls back to oldest file when session predates all", () => {
    const p = loadPricingForDate(new Date("2020-01-01T00:00:00Z"));
    expect(p.as_of).toBe("2026-05-01"); // single file in bundle
  });

  it("pricingAgeDays gives positive days when now > as_of", () => {
    const p = loadPricingForDate(new Date("2026-05-01T00:00:00Z"));
    expect(pricingAgeDays(p, new Date("2026-06-01T00:00:00Z"))).toBe(31);
  });

  it("priceForModel matches aliases", () => {
    const p = loadPricingForDate(new Date("2026-05-01T00:00:00Z"));
    expect(priceForModel(p, "claude-opus-4")).toBeDefined();
    expect(priceForModel(p, "claude-opus-4-7")).toBeDefined();
    expect(priceForModel(p, "claude-sonnet-4-5")).toBeDefined();
    expect(priceForModel(p, "claude-haiku-4")).toBeDefined();
    expect(priceForModel(p, "mistral-large")).toBeUndefined();
  });
});

// Regressions fixed in v1.6.21 (each case below priced wrong before).
describe("pricing v1.6.21 corrections", () => {
  const now = loadPricingForDate(new Date("2026-10-08"));

  it("prices Opus 4.5-4.8 at $5/$25, not Opus 4's $15/$75", () => {
    for (const m of ["claude-opus-4-5", "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8"]) {
      expect(priceForModel(now, m)?.input_per_mtok).toBe(5);
      expect(priceForModel(now, m)?.output_per_mtok).toBe(25);
    }
    expect(priceForModel(now, "claude-opus-4")?.input_per_mtok).toBe(15);
  });

  it("knows the 5.x models (they used to cost $0)", () => {
    expect(priceForModel(now, "claude-opus-5")?.input_per_mtok).toBe(5);
    expect(priceForModel(now, "claude-opus-5-5")?.cache_read_per_mtok).toBe(0.2);
    expect(priceForModel(now, "claude-sonnet-5-5")?.output_per_mtok).toBe(10);
    expect(priceForModel(now, "claude-fable-5-1")?.cache_read_per_mtok).toBe(0.25);
  });

  it("picks the most specific key for dated or longer ids", () => {
    expect(priceForModel(now, "claude-haiku-4-5-20251001")?.input_per_mtok).toBe(1);
    expect(priceForModel(now, "claude-opus-5-5")?.input_per_mtok).toBe(4);
  });

  it("fills models missing from an older dated file with the newest prices", () => {
    const june = loadPricingForDate(new Date("2026-07-30")); // 2026-06-11 table has no Opus 5
    expect(priceForModel(june, "claude-opus-5")?.input_per_mtok).toBe(5);
  });

  it("carries 1-hour cache write rates and Haiku 5.5's long-prompt tier", () => {
    expect(priceForModel(now, "claude-opus-5")?.cache_creation_1h_per_mtok).toBe(10);
    const h = priceForModel(now, "claude-haiku-5-5");
    expect(h?.input_per_mtok).toBe(0.1);
    expect(h?.long_prompt?.over_tokens).toBe(100000);
    expect(h?.long_prompt?.input_per_mtok).toBe(0.5);
  });
});

describe("OpenAI models (Codex)", () => {
  const p = loadPricingForDate(new Date("2026-10-08"));
  it("prices gpt-6.1-sol with its long-context tier", () => {
    const r = priceForModel(p, "gpt-6.1-sol");
    expect(r?.input_per_mtok).toBe(2);
    expect(r?.cache_read_per_mtok).toBe(0.1);
    expect(r?.long_prompt?.over_tokens).toBe(272000);
    expect(r?.long_prompt?.output_per_mtok).toBe(15);
  });
  it("is available for older session dates too", () => {
    expect(priceForModel(loadPricingForDate(new Date("2026-04-01")), "gpt-5.4")?.input_per_mtok).toBe(2.5);
  });
  it("leaves unknown models unpriced", () => {
    expect(priceForModel(p, "codex-auto-review")).toBeUndefined();
  });
  it("never prices a pro or nano variant at its base model's rate", () => {
    expect(priceForModel(p, "gpt-5.5-pro")?.input_per_mtok).toBe(30);
    expect(priceForModel(p, "gpt-5.4-pro")?.output_per_mtok).toBe(180);
    expect(priceForModel(p, "gpt-5.4-nano")?.input_per_mtok).toBe(0.2);
    expect(priceForModel(p, "gpt-5-nano")?.input_per_mtok).toBe(0.05);
  });
  it("resolves dated ids and keeps mini on its own row", () => {
    expect(priceForModel(p, "gpt-5.4-2026-03-01")?.input_per_mtok).toBe(2.5);
    expect(priceForModel(p, "gpt-5.4-mini")?.input_per_mtok).toBe(0.75);
  });
  it("keeps Claude models intact after the merge", () => {
    expect(priceForModel(p, "claude-opus-4-8")).toBeDefined();
  });
});

describe("Codex model rows (OpenAI model pages, 2026-10-09)", () => {
  const p = loadPricingForDate(new Date("2026-10-09"));
  const row = (m: string) => {
    const r = priceForModel(p, m);
    return r && [r.input_per_mtok, r.cache_read_per_mtok, r.output_per_mtok];
  };
  it("prices each Codex model OpenAI lists a price for, on its own row", () => {
    expect(row("gpt-5-codex")).toEqual([1.25, 0.125, 10]);
    expect(row("gpt-5.1-codex")).toEqual([1.25, 0.125, 10]);
    expect(row("gpt-5.1-codex-max")).toEqual([1.25, 0.125, 10]);
    expect(row("gpt-5.1-codex-mini")).toEqual([0.25, 0.025, 2]);
    expect(row("gpt-5.2-codex")).toEqual([1.75, 0.175, 14]);
    expect(row("gpt-5.3-codex")).toEqual([1.75, 0.175, 14]);
    expect(row("codex-mini-latest")).toEqual([1.5, 0.375, 6]);
  });
  it("keeps Codex's own helper model unpriced (no official price)", () => {
    expect(priceForModel(p, "codex-auto-review")).toBeUndefined();
  });
});

describe("snapshot-id matching", () => {
  const p = loadPricingForDate(new Date("2026-10-08"));
  it("resolves dated and versioned snapshot ids to their base row", () => {
    expect(priceForModel(p, "claude-haiku-4-5-20251001")?.input_per_mtok).toBe(1);
    expect(priceForModel(p, "gpt-5.4-2026-03-01")?.input_per_mtok).toBe(2.5);
    expect(priceForModel(p, "gpt-5.4-mini-2026-03-01")?.input_per_mtok).toBe(0.75);
  });
  it("leaves non-snapshot suffixes without their own row unpriced", () => {
    expect(priceForModel(p, "gpt-5-codex-mini")).toBeUndefined();
    expect(priceForModel(p, "gpt-5.4-codex")).toBeUndefined();
    expect(priceForModel(p, "gpt-5.4-turbo")).toBeUndefined();
    expect(priceForModel(p, "claude-opus-5-5[1m]")).toBeUndefined();
    expect(priceForModel(p, "<synthetic>")).toBeUndefined();
  });
  it("does not let a minor-version suffix borrow a base model's price", () => {
    expect(priceForModel(p, "claude-opus-5-6")).toBeUndefined();
    expect(priceForModel(p, "claude-sonnet-5-6")).toBeUndefined();
    expect(priceForModel(p, "claude-opus-4-10")).toBeUndefined();
    expect(priceForModel(p, "gpt-5-1")).toBeUndefined();
  });
  it("still prefers exact rows over a shorter key with a digit-suffix", () => {
    expect(priceForModel(p, "gpt-5.5-pro")?.input_per_mtok).toBe(30);
    expect(priceForModel(p, "claude-opus-5-5")?.input_per_mtok).toBe(4);
  });
});

describe("pricingAsOf (date shown next to a session's cost)", () => {
  it("is the Anthropic table date for Claude Code and the OpenAI table date for Codex", () => {
    const p = loadPricingForDate(new Date("2026-10-08T00:00:00Z"));
    expect(pricingAsOf(p, "anthropic")).toBe(p.as_of);
    const openai = JSON.parse(
      readFileSync(new URL("../../src/lib/pricing/openai-2026-10-09.json", import.meta.url), "utf-8"),
    ) as { as_of: string };
    expect(pricingAsOf(p, "openai")).toBe(openai.as_of);
    // An old Anthropic table does not change the OpenAI date.
    expect(pricingAsOf(loadPricingForDate(new Date("2026-05-02T00:00:00Z")), "openai")).toBe(openai.as_of);
  });

  it("daysSinceAsOf counts whole UTC days", () => {
    expect(daysSinceAsOf("2026-10-01", new Date("2026-10-08T23:00:00Z"))).toBe(7);
  });
});
