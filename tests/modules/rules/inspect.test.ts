import { describe, expect, it } from "vitest";
import { inspectRules } from "../../../src/modules/rules/inspect.js";
import { installRules } from "../../../src/modules/rules/install.js";

describe("inspectRules", () => {
  it("reports not-installed for empty file", () => {
    expect(inspectRules("")).toEqual({ installed: false });
  });

  it("reports not-installed for file without sipcode wrapper", () => {
    expect(inspectRules("# just notes\n")).toEqual({ installed: false });
  });

  it("reports not-installed when only manifest sub-block is present", () => {
    const content =
      `<!-- sipcode:start v=2 -->\n` +
      `<!-- sipcode:block name="manifest" -->\n## Sipcode\nstuff\n<!-- /sipcode:block -->\n\n` +
      `<!-- sipcode:end -->\n`;
    expect(inspectRules(content).installed).toBe(false);
  });

  it("reads mode from the attribute", () => {
    for (const m of ["default", "strict", "verbose"] as const) {
      const r = installRules("", m);
      if (!r.ok) throw new Error("setup");
      expect(inspectRules(r.value)).toEqual({ installed: true, mode: m });
    }
  });

  it("ignores unknown mode attribute values gracefully", () => {
    const content =
      `<!-- sipcode:start v=2 -->\n` +
      `<!-- sipcode:block name="output-compression" mode="bogus" -->\nbody\n<!-- /sipcode:block -->\n\n` +
      `<!-- sipcode:end -->\n`;
    const s = inspectRules(content);
    expect(s.installed).toBe(true);
    expect(s.mode).toBeUndefined();
  });
});
