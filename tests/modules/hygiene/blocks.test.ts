import { describe, expect, it } from "vitest";
import { renderHygieneBlock } from "../../../src/modules/hygiene/blocks.js";
import { approxTokenCount } from "../../../src/lib/tokenizer.js";

describe("renderHygieneBlock", () => {
  it("default block is tagged default and contains the canonical heading", () => {
    const b = renderHygieneBlock("default");
    expect(b.mode).toBe("default");
    expect(b.body).toContain("## Sipcode Session Hygiene");
    expect(b.body).toContain("mode: default");
  });

  it("contains all six default rules and the honest-limit footer", () => {
    const body = renderHygieneBlock("default").body;
    for (let n = 1; n <= 6; n++) {
      expect(body).toContain(`${n}. **`);
    }
    expect(body).toContain("honest limit:");
    expect(body).toContain("can warn — they can't force");
  });

  it("is under the 400-token brand-voice budget", () => {
    const body = renderHygieneBlock("default").body;
    const tokens = approxTokenCount(body);
    expect(tokens, `block exceeded 400 tokens: ${tokens}`).toBeLessThan(400);
  });

  it("is deterministic — same call returns identical body", () => {
    expect(renderHygieneBlock("default").body).toBe(
      renderHygieneBlock("default").body,
    );
  });

  it("never names a non-existent feature like S033", () => {
    // S033 (MCP pruning) is deferred. The block must not advertise it.
    const body = renderHygieneBlock("default").body;
    expect(body).not.toContain("S033");
    expect(body).not.toContain("MCP");
  });

  it("default mode snapshot", () => {
    expect(renderHygieneBlock("default").body).toMatchSnapshot();
  });
});
