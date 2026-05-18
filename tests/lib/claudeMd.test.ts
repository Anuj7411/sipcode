import { describe, expect, it } from "vitest";
import {
  MARKER_END,
  MARKER_START,
  MARKER_START_V1,
  MARKER_START_V2,
  extractExisting,
  injectSection,
  listSubBlocks,
  parseSubBlocks,
  removeSubBlock,
  renderSipcodeBlock,
  renderSubBlocks,
  upsertSubBlock,
  type SubBlock,
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

// ---- v=2 sub-block coverage ----

describe("MARKER_START", () => {
  it("defaults to v=2", () => {
    expect(MARKER_START).toBe(MARKER_START_V2);
  });
});

describe("extractExisting (v=2)", () => {
  it("reads version 2 markers", () => {
    const content = `${MARKER_START_V2}\nbody\n${MARKER_END}\n`;
    const r = extractExisting(content);
    expect(r?.version).toBe(2);
    expect(r?.sipcode).toBe("\nbody\n");
  });

  it("reads version 1 markers as version=1", () => {
    const content = `${MARKER_START_V1}\nbody\n${MARKER_END}\n`;
    const r = extractExisting(content);
    expect(r?.version).toBe(1);
    expect(r?.sipcode).toBe("\nbody\n");
  });

  it("flags v=2 duplicates as unsafe", () => {
    const content = `${MARKER_START_V2}\nx\n${MARKER_END}\n${MARKER_START_V2}\ny\n${MARKER_END}`;
    const r = extractExisting(content);
    expect(r?.sipcode).toBeUndefined();
  });
});

describe("parseSubBlocks", () => {
  it("treats marker-less body as a single anonymous manifest block", () => {
    const subs = parseSubBlocks("\nsome legacy v=1 body\n");
    expect(subs).toEqual([{ name: "manifest", body: "\nsome legacy v=1 body\n" }]);
  });

  it("parses two named sub-blocks with attributes", () => {
    const body =
      `\n<!-- sipcode:block name="manifest" -->m-body<!-- /sipcode:block -->\n` +
      `\n<!-- sipcode:block name="output-compression" mode="strict" -->oc-body<!-- /sipcode:block -->\n`;
    const subs = parseSubBlocks(body);
    expect(subs).toEqual([
      { name: "manifest", body: "m-body" },
      { name: "output-compression", mode: "strict", body: "oc-body" },
    ]);
  });

  it("returns null on an unclosed sub-block", () => {
    const body = `\n<!-- sipcode:block name="manifest" -->forever\n`;
    expect(parseSubBlocks(body)).toBeNull();
  });
});

describe("renderSubBlocks", () => {
  it("round-trips with parseSubBlocks", () => {
    const subs: SubBlock[] = [
      { name: "manifest", body: "\nbody A\n" },
      { name: "output-compression", mode: "default", body: "\nbody B\n" },
    ];
    const rendered = renderSubBlocks(subs);
    const reparsed = parseSubBlocks(rendered);
    expect(reparsed).toEqual(subs);
  });
});

describe("upsertSubBlock", () => {
  it("creates a v=2 wrapper for an empty file", () => {
    const r = upsertSubBlock("", { name: "output-compression", body: "x", mode: "default" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain(MARKER_START_V2);
    expect(r.value).toContain(`name="output-compression"`);
    expect(r.value).toContain(`mode="default"`);
  });

  it("migrates a v=1 wrapper to v=2 when upserting a different named block", () => {
    const v1Content = `${MARKER_START_V1}\nold-body\n${MARKER_END}\n`;
    const r = upsertSubBlock(v1Content, {
      name: "output-compression",
      mode: "default",
      body: "new",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain(MARKER_START_V2);
    expect(r.value).not.toContain(MARKER_START_V1);
    // The legacy body becomes a named "manifest" sub-block, preserved.
    expect(r.value).toContain(`name="manifest"`);
    expect(r.value).toContain("old-body");
    expect(r.value).toContain(`name="output-compression"`);
    expect(r.value).toContain("new");
  });

  it("adds a second sub-block without disturbing the first", () => {
    const first = upsertSubBlock("", {
      name: "manifest",
      body: "\n## Sipcode\n",
    });
    if (!first.ok) throw new Error("setup");
    const second = upsertSubBlock(first.value, {
      name: "output-compression",
      mode: "default",
      body: "\nSipcode Output Compression\n",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const subs = listSubBlocks(second.value)!;
    expect(subs.map((s) => s.name)).toEqual(["manifest", "output-compression"]);
  });

  it("is idempotent across multiple sub-blocks", () => {
    const r1 = upsertSubBlock("", { name: "manifest", body: "\n## Sipcode\n" });
    if (!r1.ok) throw new Error("setup");
    const r2 = upsertSubBlock(r1.value, {
      name: "output-compression",
      mode: "default",
      body: "\nSipcode Output Compression\n",
    });
    if (!r2.ok) throw new Error("setup");
    const r3 = upsertSubBlock(r2.value, {
      name: "output-compression",
      mode: "default",
      body: "\nSipcode Output Compression\n",
    });
    expect(r3.ok).toBe(true);
    if (r3.ok) expect(r3.value).toBe(r2.value);
  });

  it("E005 when a sub-block body looks hand-edited", () => {
    const tampered =
      `${MARKER_START_V2}\n` +
      `<!-- sipcode:block name="output-compression" mode="default" -->\nUSER WROTE PROSE\n<!-- /sipcode:block -->\n` +
      `\n${MARKER_END}\n`;
    const r = upsertSubBlock(tampered, {
      name: "output-compression",
      mode: "default",
      body: "\nSipcode Output Compression\n",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("E005");
  });

  it("E005 when sub-block is unclosed", () => {
    const broken = `${MARKER_START_V2}\n<!-- sipcode:block name="x" -->never closes\n${MARKER_END}\n`;
    const r = upsertSubBlock(broken, { name: "y", body: "z" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("E005");
  });
});

describe("removeSubBlock", () => {
  it("no-ops when sub-block is absent", () => {
    const r = removeSubBlock("# notes\n", "output-compression");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("# notes\n");
  });

  it("removes one of two sub-blocks, leaves the other", () => {
    const r1 = upsertSubBlock("", { name: "manifest", body: "\n## Sipcode\n" });
    if (!r1.ok) throw new Error("setup");
    const r2 = upsertSubBlock(r1.value, {
      name: "output-compression",
      mode: "default",
      body: "\nSipcode Output Compression\n",
    });
    if (!r2.ok) throw new Error("setup");
    const r3 = removeSubBlock(r2.value, "output-compression");
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.value).toContain(`name="manifest"`);
    expect(r3.value).not.toContain(`name="output-compression"`);
  });

  it("removes the outer wrapper when last sub-block is removed", () => {
    const r1 = upsertSubBlock("# notes\n", {
      name: "output-compression",
      mode: "default",
      body: "\nSipcode Output Compression\n",
    });
    if (!r1.ok) throw new Error("setup");
    const r2 = removeSubBlock(r1.value, "output-compression");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value).not.toContain(MARKER_START_V2);
    expect(r2.value).not.toContain(MARKER_END);
    expect(r2.value).toContain("# notes");
  });
});

describe("renderSipcodeBlock (legacy entry point)", () => {
  it("still produces a manifest-body string", () => {
    const block = renderSipcodeBlock({
      manifestPath: ".sipcode/manifest.md",
      generatedAt: "now",
    });
    expect(block).toContain("## Sipcode");
  });
});

