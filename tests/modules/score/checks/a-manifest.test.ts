import { describe, expect, it } from "vitest";
import "../../../../src/modules/score/checks/index.js";
import { getCheck } from "../../../../src/modules/score/registry.js";
import { checkId } from "../../../../src/modules/score/types.js";
import { buildSyntheticSnapshot } from "../_snapshotBuilder.js";

const sc = (id: string) => getCheck(checkId(id))!;

describe("SC001 — CLAUDE.md exists", () => {
  it("passes when claudeMd has content", () => {
    const r = sc("SC001").run(
      buildSyntheticSnapshot({ claudeMd: "# rules\n\nbody" }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when claudeMd is missing", () => {
    const r = sc("SC001").run(buildSyntheticSnapshot({}));
    expect(r.passed).toBe(false);
    expect(r.details).toContain("CLAUDE.md");
  });
  it("fails when claudeMd is whitespace only", () => {
    const r = sc("SC001").run(buildSyntheticSnapshot({ claudeMd: "   \n  " }));
    expect(r.passed).toBe(false);
  });
});

describe("SC002 — CLAUDE.md under 4000 tokens", () => {
  it("passes when CLAUDE.md is short", () => {
    const r = sc("SC002").run(buildSyntheticSnapshot({ claudeMd: "tiny" }));
    expect(r.passed).toBe(true);
  });
  it("fails when CLAUDE.md is over the cap (~16k+ chars)", () => {
    const huge = "x ".repeat(10000);
    const r = sc("SC002").run(buildSyntheticSnapshot({ claudeMd: huge }));
    expect(r.passed).toBe(false);
    expect(r.details).toMatch(/tokens/);
  });
  it("fails when there is no CLAUDE.md", () => {
    const r = sc("SC002").run(buildSyntheticSnapshot({}));
    expect(r.passed).toBe(false);
  });
});

describe("SC003 — project manifest present", () => {
  it("passes when AGENTS.md is present", () => {
    const r = sc("SC003").run(
      buildSyntheticSnapshot({ agentsMd: "# manifest\n\nbody" }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes when sipcode manifest is present", () => {
    const r = sc("SC003").run(
      buildSyntheticSnapshot({ sipcodeManifest: "# sipcode" }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes when README has a meaty opening section (>= 80 words)", () => {
    const opening = Array(100).fill("word").join(" ");
    const r = sc("SC003").run(
      buildSyntheticSnapshot({ readme: `# Title\n\n${opening}\n\n## Next\n` }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails with a thin README and no manifest", () => {
    const r = sc("SC003").run(
      buildSyntheticSnapshot({ readme: "# Title\n\nfew words." }),
    );
    expect(r.passed).toBe(false);
  });
});

describe("SC004 — CLAUDE.md mentions routing rules", () => {
  it("passes when CLAUDE.md references a /slash-command", () => {
    const r = sc("SC004").run(
      buildSyntheticSnapshot({ claudeMd: "use /deploy for shipping" }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes when CLAUDE.md mentions skills", () => {
    const r = sc("SC004").run(
      buildSyntheticSnapshot({ claudeMd: "the skills layer handles routing" }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when CLAUDE.md says nothing about routing", () => {
    const r = sc("SC004").run(
      buildSyntheticSnapshot({ claudeMd: "this is a project. behave." }),
    );
    expect(r.passed).toBe(false);
  });
});

describe("SC005 — no conflicting routing sources", () => {
  it("passes when only CLAUDE.md is present", () => {
    const r = sc("SC005").run(
      buildSyntheticSnapshot({ claudeMd: "# rules" }),
    );
    expect(r.passed).toBe(true);
  });
  it("passes when CLAUDE.md and .cursorrules say substantially the same thing", () => {
    const same = "# rules\n\nuse /deploy. follow conventions.";
    const r = sc("SC005").run(
      buildSyntheticSnapshot({ claudeMd: same, cursorRules: same }),
    );
    expect(r.passed).toBe(true);
  });
  it("fails when CLAUDE.md and .cursorrules diverge", () => {
    const r = sc("SC005").run(
      buildSyntheticSnapshot({
        claudeMd:
          "# claude rules\n\nthese are the rules for claude code only and they describe routing details.",
        cursorRules:
          "# cursor rules\n\nthese are the rules for cursor only and they describe a different routing approach.",
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.details).toContain("source of truth");
  });
});
