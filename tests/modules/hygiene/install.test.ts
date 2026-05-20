import { describe, expect, it } from "vitest";
import {
  installHygieneBlock,
  uninstallHygieneBlock,
} from "../../../src/modules/hygiene/install.js";
import {
  MARKER_END,
  MARKER_START_V2,
} from "../../../src/lib/claudeMd.js";

describe("installHygieneBlock", () => {
  it("creates a v=2 wrapper with session-hygiene sub-block for empty input", () => {
    const r = installHygieneBlock("", "default");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain(MARKER_START_V2);
    expect(r.value).toContain(MARKER_END);
    expect(r.value).toContain(`name="session-hygiene"`);
    expect(r.value).toContain(`mode="default"`);
    expect(r.value).toContain("Sipcode Session Hygiene");
  });

  it("is idempotent at the same mode", () => {
    const first = installHygieneBlock("", "default");
    if (!first.ok) throw new Error("setup");
    const second = installHygieneBlock(first.value, "default");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value).toBe(first.value);
  });

  it("coexists with existing manifest + output-compression sub-blocks", () => {
    const existing =
      `${MARKER_START_V2}\n` +
      `<!-- sipcode:block name="manifest" -->\n## Sipcode\n(manifest)\n<!-- /sipcode:block -->\n\n` +
      `<!-- sipcode:block name="output-compression" mode="default" -->\n## Sipcode Output Compression\n(rules)\n<!-- /sipcode:block -->\n\n` +
      `${MARKER_END}\n`;
    const r = installHygieneBlock(existing, "default");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain(`name="manifest"`);
    expect(r.value).toContain(`name="output-compression"`);
    expect(r.value).toContain(`name="session-hygiene"`);
  });

  it("preserves content outside the markers", () => {
    const existing = "# my project\nuse tabs.\n";
    const r = installHygieneBlock(existing, "default");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startsWith("# my project\nuse tabs.\n")).toBe(true);
  });

  it("E005 when session-hygiene body is hand-edited", () => {
    const tampered =
      `${MARKER_START_V2}\n` +
      `<!-- sipcode:block name="session-hygiene" mode="default" -->\nUSER PROSE\n<!-- /sipcode:block -->\n\n` +
      `${MARKER_END}\n`;
    const r = installHygieneBlock(tampered, "default");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("E005");
  });
});

describe("uninstallHygieneBlock", () => {
  it("removes only the session-hygiene sub-block, preserves siblings", () => {
    const r1 = installHygieneBlock("", "default");
    if (!r1.ok) throw new Error("setup");
    const withManifest = r1.value.replace(
      MARKER_END,
      `<!-- sipcode:block name="manifest" -->\n## Sipcode\nstuff\n<!-- /sipcode:block -->\n\n${MARKER_END}`,
    );
    const r2 = uninstallHygieneBlock(withManifest);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value).toContain(`name="manifest"`);
    expect(r2.value).not.toContain(`name="session-hygiene"`);
  });

  it("removes the whole wrapper when hygiene was the only block", () => {
    const r1 = installHygieneBlock("# notes\n", "default");
    if (!r1.ok) throw new Error("setup");
    const r2 = uninstallHygieneBlock(r1.value);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value).not.toContain(MARKER_START_V2);
    expect(r2.value).toContain("# notes");
  });

  it("no-ops when hygiene is not installed", () => {
    const r = uninstallHygieneBlock("# nothing here\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("# nothing here\n");
  });
});
