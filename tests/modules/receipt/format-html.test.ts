import { describe, expect, it } from "vitest";
import { formatHtml } from "../../../src/modules/receipt/format-html.js";
import type { ReceiptModel } from "../../../src/modules/receipt/types.js";

function model(variant: "post-install" | "pre-install"): ReceiptModel {
  return {
    schemaVersion: "sipcode-receipt/1",
    variant,
    header: {
      sessionIdShort: "4f2a",
      dateDisplay: "May 18, 2026",
      durationDisplay: "12m 3s",
    },
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
    footer: { tagline: "sip your tokens. don't gulp them.", url: "sipcode.dev" },
  };
}

describe("formatHtml", () => {
  it("emits standalone html with no <script> tags and no external links", () => {
    const html = formatHtml(model("post-install"));
    expect(html).toMatch(/^<!doctype html>/);
    expect(html.includes("<script")).toBe(false);
    // No remote URLs anywhere (file is fully standalone).
    expect(/<link\s+[^>]*href=/.test(html)).toBe(false);
  });

  it("post-install uses mint accent on the hero number", () => {
    const html = formatHtml(model("post-install"));
    expect(html.toLowerCase()).toContain("#3ddc97");
    expect(html.toLowerCase()).not.toContain("#ff6b6b");
  });

  it("pre-install uses red accent on the hero number", () => {
    const html = formatHtml(model("pre-install"));
    expect(html.toLowerCase()).toContain("#ff6b6b");
    expect(html.toLowerCase()).not.toContain("#3ddc97");
  });

  it("escapes html-special characters", () => {
    const m = model("post-install");
    const evil = { ...m, footer: { ...m.footer, tagline: "<script>x</script>" } };
    const html = formatHtml(evil);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("contains the locked tagline and url verbatim (post escaping)", () => {
    const html = formatHtml(model("post-install"));
    expect(html).toContain("sip your tokens. don&#39;t gulp them.");
    expect(html).toContain("sipcode.dev");
  });

  it("uses lowercase hex codes (snapshot constraint)", () => {
    const html = formatHtml(model("post-install"));
    const upperHexCount = (html.match(/#[0-9A-F]{3,6}\b/g) ?? []).length;
    expect(upperHexCount).toBe(0);
  });

  it("is byte-identical when re-rendered (idempotent)", () => {
    const a = formatHtml(model("post-install"));
    const b = formatHtml(model("post-install"));
    expect(a).toBe(b);
  });
});
