import { describe, expect, it } from "vitest";
import {
  installRules,
  uninstallRules,
} from "../../../src/modules/rules/install.js";
import { inspectRules } from "../../../src/modules/rules/inspect.js";
import {
  MARKER_END,
  MARKER_START_V2,
} from "../../../src/lib/claudeMd.js";

describe("installRules", () => {
  it("creates a v=2 wrapper with output-compression sub-block for empty CLAUDE.md", () => {
    const r = installRules("", "default");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain(MARKER_START_V2);
    expect(r.value).toContain(MARKER_END);
    expect(r.value).toContain(`name="output-compression"`);
    expect(r.value).toContain(`mode="default"`);
    expect(r.value).toContain("Sipcode Output Compression");
  });

  it("is idempotent at the same mode", () => {
    const first = installRules("", "default");
    if (!first.ok) throw new Error("setup");
    const second = installRules(first.value, "default");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value).toBe(first.value);
  });

  it("switches modes and replaces the body", () => {
    const r1 = installRules("", "default");
    if (!r1.ok) throw new Error("setup");
    const r2 = installRules(r1.value, "strict");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value).toContain(`mode="strict"`);
    expect(r2.value).not.toContain(`mode="default"`);
    expect(r2.value).toContain("strict additions");
  });

  it("coexists with an existing manifest sub-block", () => {
    // Pretend a manifest block was already injected by `sipcode init`.
    const existing =
      `${MARKER_START_V2}\n` +
      `<!-- sipcode:block name="manifest" -->\n## Sipcode\n(manifest stuff)\n<!-- /sipcode:block -->\n\n` +
      `${MARKER_END}\n`;
    const r = installRules(existing, "default");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toContain(`name="manifest"`);
    expect(r.value).toContain("(manifest stuff)");
    expect(r.value).toContain(`name="output-compression"`);
  });

  it("preserves content outside the markers", () => {
    const existing = "# my project\nuse tabs.\n";
    const r = installRules(existing, "default");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.startsWith("# my project\nuse tabs.\n")).toBe(true);
  });

  it("E005 when output-compression body is hand-edited", () => {
    const tampered =
      `${MARKER_START_V2}\n` +
      `<!-- sipcode:block name="output-compression" mode="default" -->\nUSER PROSE\n<!-- /sipcode:block -->\n\n` +
      `${MARKER_END}\n`;
    const r = installRules(tampered, "default");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]?.code).toBe("E005");
  });
});

describe("uninstallRules", () => {
  it("removes only the output-compression sub-block, keeps manifest", () => {
    const r1 = installRules("", "default");
    if (!r1.ok) throw new Error("setup");
    // Add a fake manifest sub-block.
    const withManifest =
      r1.value.replace(
        MARKER_END,
        `<!-- sipcode:block name="manifest" -->\n## Sipcode\nstuff\n<!-- /sipcode:block -->\n\n${MARKER_END}`,
      );
    const r2 = uninstallRules(withManifest);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value).toContain(`name="manifest"`);
    expect(r2.value).not.toContain(`name="output-compression"`);
  });

  it("removes the whole wrapper when output-compression was the only block", () => {
    const r1 = installRules("# notes\n", "default");
    if (!r1.ok) throw new Error("setup");
    const r2 = uninstallRules(r1.value);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value).not.toContain(MARKER_START_V2);
    expect(r2.value).toContain("# notes");
  });

  it("no-ops when output-compression is not installed", () => {
    const r = uninstallRules("# nothing here\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("# nothing here\n");
  });
});

describe("install + inspect round-trip", () => {
  it("install -> inspect reports installed at correct mode", () => {
    for (const mode of ["default", "strict", "verbose"] as const) {
      const r = installRules("", mode);
      if (!r.ok) throw new Error("setup");
      const state = inspectRules(r.value);
      expect(state.installed).toBe(true);
      expect(state.mode).toBe(mode);
    }
  });

  it("uninstall -> inspect reports not installed", () => {
    const r1 = installRules("", "default");
    if (!r1.ok) throw new Error("setup");
    const r2 = uninstallRules(r1.value);
    if (!r2.ok) throw new Error("setup");
    const state = inspectRules(r2.value);
    expect(state.installed).toBe(false);
  });
});
