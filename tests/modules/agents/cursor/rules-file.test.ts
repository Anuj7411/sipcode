import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../../src/lib/fs.js";
import {
  buildMdcContent,
  removeCursorBlock,
  resolveCursorRulesPath,
  SIPCODE_MDC_FRONTMATTER,
  splitFrontmatter,
  upsertCursorBlock,
} from "../../../../src/modules/agents/cursor/rules-file.js";

describe("resolveCursorRulesPath", () => {
  it("prefers existing .cursor/rules/sipcode.mdc", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/.cursor/rules/sipcode.mdc", "x");
    const r = await resolveCursorRulesPath(fs, "/proj");
    expect(r.exists).toBe(true);
    expect(r.isMdc).toBe(true);
    expect(r.path.replace(/\\/g, "/")).toBe("/proj/.cursor/rules/sipcode.mdc");
  });

  it("falls back to legacy .cursorrules when .mdc doesn't exist", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/.cursorrules", "x");
    const r = await resolveCursorRulesPath(fs, "/proj");
    expect(r.exists).toBe(true);
    expect(r.isMdc).toBe(false);
    expect(r.path.replace(/\\/g, "/")).toBe("/proj/.cursorrules");
  });

  it("defaults to new .mdc path when nothing exists", async () => {
    const fs = new InMemoryFs();
    const r = await resolveCursorRulesPath(fs, "/proj");
    expect(r.exists).toBe(false);
    expect(r.isMdc).toBe(true);
    expect(r.path.replace(/\\/g, "/")).toBe("/proj/.cursor/rules/sipcode.mdc");
  });

  it("preferLegacy=true returns .cursorrules when nothing exists", async () => {
    const fs = new InMemoryFs();
    const r = await resolveCursorRulesPath(fs, "/proj", true);
    expect(r.exists).toBe(false);
    expect(r.isMdc).toBe(false);
    expect(r.path.replace(/\\/g, "/")).toBe("/proj/.cursorrules");
  });
});

describe("splitFrontmatter", () => {
  it("splits frontmatter cleanly", () => {
    const s = "---\ndescription: x\n---\nbody";
    const { frontmatter, body } = splitFrontmatter(s);
    expect(frontmatter).toBe("---\ndescription: x\n---\n");
    expect(body).toBe("body");
  });

  it("returns empty frontmatter when none present", () => {
    const s = "hello world";
    expect(splitFrontmatter(s)).toEqual({ frontmatter: "", body: "hello world" });
  });
});

describe("buildMdcContent", () => {
  it("preserves existing frontmatter", () => {
    const out = buildMdcContent({
      existing: "---\nfoo: bar\n---\nold body",
      injectedBody: "NEW",
      ensureFrontmatter: true,
    });
    expect(out).toBe("---\nfoo: bar\n---\nNEW");
  });

  it("adds canonical frontmatter when ensureFrontmatter=true and none exists", () => {
    const out = buildMdcContent({
      existing: "",
      injectedBody: "NEW",
      ensureFrontmatter: true,
    });
    expect(out.startsWith(SIPCODE_MDC_FRONTMATTER)).toBe(true);
    expect(out.endsWith("NEW")).toBe(true);
  });
});

describe("upsertCursorBlock", () => {
  it("for .mdc files preserves frontmatter and adds sipcode markers", () => {
    const r = upsertCursorBlock(
      "---\nfoo: bar\n---\n",
      { name: "manifest", body: "\nhi\n" },
      true,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain("---\nfoo: bar\n---\n");
      expect(r.value).toContain("<!-- sipcode:start v=2 -->");
      expect(r.value).toContain('name="manifest"');
    }
  });

  it("for .mdc files with empty existing adds canonical frontmatter", () => {
    const r = upsertCursorBlock(
      "",
      { name: "manifest", body: "\nhi\n" },
      true,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain(SIPCODE_MDC_FRONTMATTER.trim());
      expect(r.value).toContain('name="manifest"');
    }
  });

  it("for legacy .cursorrules no frontmatter is added", () => {
    const r = upsertCursorBlock(
      "user notes\n",
      { name: "manifest", body: "\nhi\n" },
      false,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain("user notes");
      expect(r.value).toContain("<!-- sipcode:start v=2 -->");
      expect(r.value).not.toMatch(/^---\n/);
    }
  });

  it("is idempotent: re-applying yields byte-identical output", () => {
    const r1 = upsertCursorBlock(
      "",
      { name: "manifest", body: "\n## Sipcode\nbody\n" },
      true,
    );
    expect(r1.ok).toBe(true);
    const first = (r1 as { ok: true; value: string }).value;
    const r2 = upsertCursorBlock(
      first,
      { name: "manifest", body: "\n## Sipcode\nbody\n" },
      true,
    );
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value).toBe(first);
  });

  it("refuses to overwrite hand-edited markers (E005)", () => {
    const r = upsertCursorBlock(
      "<!-- sipcode:start v=2 -->\nMY WRITING\n<!-- sipcode:end -->",
      { name: "manifest", body: "\nhi\n" },
      true,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]!.code).toBe("E005");
  });
});

describe("removeCursorBlock", () => {
  it("removes the named sub-block while keeping frontmatter", () => {
    const start = upsertCursorBlock(
      "---\nx: 1\n---\n",
      { name: "manifest", body: "\nhi\n" },
      true,
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const removed = removeCursorBlock(start.value, "manifest", true);
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.value).toContain("---\nx: 1\n---\n");
      expect(removed.value).not.toContain('name="manifest"');
    }
  });

  it("is a no-op for legacy files when block name not present", () => {
    const r = removeCursorBlock("plain notes\n", "manifest", false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("plain notes\n");
  });
});
