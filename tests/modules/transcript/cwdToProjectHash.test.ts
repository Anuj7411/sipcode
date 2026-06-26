import { describe, it, expect } from "vitest";
import { cwdToProjectHash } from "../../../src/modules/transcript/discover.js";

describe("cwdToProjectHash", () => {
  it("matches Claude Code's dir name for a Windows path WITH A SPACE", () => {
    // regression: "just research" must become "just-research", not keep the space
    expect(cwdToProjectHash("C:\\Projects\\just research")).toBe(
      "C--Projects-just-research",
    );
  });

  it("matches a plain Windows path (no regression for the common case)", () => {
    expect(cwdToProjectHash("C:\\Projects\\Sipcode")).toBe(
      "C--Projects-Sipcode",
    );
  });

  it("encodes a POSIX path", () => {
    expect(cwdToProjectHash("/home/u/proj")).toBe("-home-u-proj");
  });

  it("collapses tabs and runs of whitespace to dashes", () => {
    expect(cwdToProjectHash("C:\\a b\tc")).toBe("C--a-b-c");
  });
});
