import { describe, expect, it } from "vitest";
import {
  MARKER_END,
  MARKER_START,
  extractExisting,
  injectSection,
  renderSipcodeBlock,
} from "../../src/lib/claudeMd.js";

const BLOCK = renderSipcodeBlock({
  manifestPath: ".sipcode/manifest.md",
  generatedAt: "HEAD@abc1234",
});

describe("renderSipcodeBlock", () => {
  it("contains the ## Sipcode heading and manifest path", () => {
    expect(BLOCK).toContain("## Sipcode");
    expect(BLOCK).toContain(".sipcode/manifest.md");
  });
});

describe("extractExisting", () => {
  it("returns null for empty content", () => {
    expect(extractExisting("")).toBeNull();
  });

  it("returns before-only when no markers present", () => {
    const r = extractExisting("# my notes\nhello");
    expect(r?.before).toBe("# my notes\nhello");
    expect(r?.sipcode).toBeUndefined();
    expect(r?.after).toBe("");
  });

  it("splits content correctly with valid markers", () => {
    const content = `# header\n${MARKER_START}\nsip body\n${MARKER_END}\n# footer`;
    const r = extractExisting(content);
    expect(r?.before).toBe("# header\n");
    expect(r?.sipcode).toBe("\nsip body\n");
    expect(r?.after).toBe("\n# footer");
  });

  it("flags duplicate markers as sipcode=undefined", () => {
    const content = `${MARKER_START}\nbody1\n${MARKER_END}\n${MARKER_START}\nbody2\n${MARKER_END}`;
    const r = extractExisting(content);
    expect(r?.sipcode).toBeUndefined();
  });
});

describe("injectSection", () => {
  it("creates a fresh file with just the block", () => {
    const r = injectSection("", BLOCK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startsWith(MARKER_START)).toBe(true);
      expect(r.value.includes(MARKER_END)).toBe(true);
      expect(r.value.includes("## Sipcode")).toBe(true);
    }
  });

  it("appends to existing content without markers", () => {
    const r = injectSection("# my project\n\nstuff", BLOCK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startsWith("# my project")).toBe(true);
      expect(r.value).toContain(MARKER_START);
      expect(r.value).toContain(MARKER_END);
    }
  });

  it("is idempotent across re-injection", () => {
    const first = injectSection("# proj", BLOCK);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = injectSection(first.value, BLOCK);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value).toBe(first.value);
    }
  });

  it("preserves before/after content when re-injecting", () => {
    const initial = injectSection("# proj\nnotes", BLOCK);
    if (!initial.ok) throw new Error("setup failed");
    const edited = initial.value + "\n\n# more notes after";
    const reinjected = injectSection(edited, BLOCK);
    expect(reinjected.ok).toBe(true);
    if (reinjected.ok) {
      expect(reinjected.value.startsWith("# proj\nnotes")).toBe(true);
      expect(reinjected.value.endsWith("# more notes after")).toBe(true);
    }
  });

  it("refuses to overwrite hand-edited body (E005)", () => {
    const tampered = `# proj\n${MARKER_START}\nUSER PROSE HERE\n${MARKER_END}`;
    const r = injectSection(tampered, BLOCK);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error[0]?.code).toBe("E005");
    }
  });

  it("refuses on duplicate markers (E005)", () => {
    const dup = `${MARKER_START}\na\n${MARKER_END}\n${MARKER_START}\nb\n${MARKER_END}`;
    const r = injectSection(dup, BLOCK);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("E005");
  });
});
