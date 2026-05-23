import { describe, expect, it } from "vitest";
import { formatPng, loadFontPack } from "../../../src/modules/receipt/format-png.js";
import type { ReceiptModel } from "../../../src/modules/receipt/types.js";

function model(variant: "post-install" | "pre-install"): ReceiptModel {
  return {
    schemaVersion: "sipcode-receipt/1",
    variant,
    header: { sessionIdShort: "4f2a", dateDisplay: "May 18, 2026", durationDisplay: "12m 3s" },
    hero: {
      tokens: 12345,
      tokensDisplay: "12,345",
      sublabel: variant === "post-install" ? "sipped" : "wasted",
      dollarDisplay: "$0.1234",
      pricingAsOf: "2026-05-01",
    },
    leaks: [
      { rank: 1, title: "duplicate file reads", tokensDisplay: "8,000" },
      { rank: 2, title: "idle context", tokensDisplay: "3,000" },
      { rank: 3, title: "cache-creation overhead", tokensDisplay: "1,345" },
    ],
    footer: { tagline: "sip your tokens. don't gulp them.", url: "github.com/Anuj7411/sipcode" },
  };
}

// PNG file signature.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("formatPng", () => {
  it("renders a valid PNG with reasonable byte length (post-install)", async () => {
    const result = await formatPng(model("post-install"));
    expect(result.ok).toBe(true);
    if (!result.ok) return; // type guard
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      expect(result.png[i]).toBe(PNG_MAGIC[i]);
    }
    expect(result.png.byteLength).toBeGreaterThan(10_000);
    expect(result.png.byteLength).toBeLessThan(500_000);
  }, 30_000);

  it("renders a valid PNG (pre-install) with different bytes than post-install", async () => {
    const a = await formatPng(model("post-install"));
    const b = await formatPng(model("pre-install"));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Different accent color → different bytes somewhere.
    expect(a.png.byteLength).not.toBe(0);
    expect(b.png.byteLength).not.toBe(0);
    let differs = false;
    for (let i = 0; i < Math.min(a.png.byteLength, b.png.byteLength); i++) {
      if (a.png[i] !== b.png[i]) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  }, 30_000);

  it("is idempotent — same input → same bytes", async () => {
    const fonts = await loadFontPack();
    const a = await formatPng(model("post-install"), { fonts });
    const b = await formatPng(model("post-install"), { fonts });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.png.byteLength).toBe(b.png.byteLength);
    // Spot-check a window of bytes — full equality is too strict if resvg
    // ever embeds a non-deterministic field, but headers + chunk structure
    // must be identical.
    for (let i = 0; i < 1024; i++) {
      expect(a.png[i]).toBe(b.png[i]);
    }
  }, 30_000);
});
