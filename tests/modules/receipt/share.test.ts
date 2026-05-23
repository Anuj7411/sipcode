import { describe, expect, it } from "vitest";
import { buildShareLinks } from "../../../src/modules/receipt/share.js";
import type { ReceiptModel } from "../../../src/modules/receipt/types.js";

function model(variant: "post-install" | "pre-install"): ReceiptModel {
  return {
    schemaVersion: "sipcode-receipt/1",
    variant,
    header: { sessionIdShort: "abcd", dateDisplay: "May 18, 2026", durationDisplay: "5m" },
    hero: {
      tokens: 9_876,
      tokensDisplay: "9,876",
      sublabel: variant === "post-install" ? "sipped" : "wasted",
      dollarDisplay: "$0.0420",
      pricingAsOf: "2026-05-01",
    },
    leaks: [],
    footer: { tagline: "sip your tokens. don't gulp them.", url: "github.com/Anuj7411/sipcode" },
  };
}

describe("buildShareLinks", () => {
  it("post-install: uses 'sipped' in tweet text", () => {
    const { tweetText, tweetIntentUrl } = buildShareLinks(model("post-install"));
    expect(tweetText).toContain("sipped 9,876 tokens");
    expect(tweetIntentUrl.startsWith("https://twitter.com/intent/tweet?text=")).toBe(true);
  });

  it("pre-install: uses 'wasted' in tweet text", () => {
    const { tweetText } = buildShareLinks(model("pre-install"));
    expect(tweetText).toContain("wasted 9,876 tokens");
  });

  it("encodes special characters into the intent URL", () => {
    const { tweetIntentUrl, tweetText } = buildShareLinks(model("post-install"));
    // Spaces become %20, commas %2C, @ becomes %40.
    // (apostrophe is not encoded by encodeURIComponent — twitter accepts it raw.)
    expect(tweetIntentUrl).toContain("%20");
    expect(tweetIntentUrl).toContain("%2C");
    expect(tweetIntentUrl).toContain("%40");
    // Decoded round-trip equals the tweet text.
    const queryStart = tweetIntentUrl.indexOf("text=") + "text=".length;
    const encoded = tweetIntentUrl.slice(queryStart);
    expect(decodeURIComponent(encoded)).toBe(tweetText);
  });

  it("includes the brand handle and tagline", () => {
    const { tweetText } = buildShareLinks(model("post-install"));
    expect(tweetText).toContain("@sipcode_dev");
    expect(tweetText).toContain("sip your tokens. don't gulp them.");
  });
});
