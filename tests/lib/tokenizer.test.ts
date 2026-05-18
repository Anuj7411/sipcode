import { describe, expect, it } from "vitest";
import { approxTokenCount } from "../../src/lib/tokenizer.js";

describe("approxTokenCount", () => {
  it("returns 0 for empty string", () => {
    expect(approxTokenCount("")).toBe(0);
  });

  it("returns ceil(length / 4)", () => {
    expect(approxTokenCount("abcd")).toBe(1);
    expect(approxTokenCount("abcde")).toBe(2);
    expect(approxTokenCount("a".repeat(40))).toBe(10);
  });

  it("matches budget-scale magnitudes", () => {
    // ~8000 chars ≈ 2000 tokens — exactly the manifest budget.
    const s = "a".repeat(8000);
    expect(approxTokenCount(s)).toBe(2000);
  });
});
