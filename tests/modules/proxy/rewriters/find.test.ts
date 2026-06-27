import { describe, it, expect } from "vitest";
import { rewriteFind } from "../../../../src/modules/proxy/rewriters/find.js";

describe("rewriteFind", () => {
  it("appends `| head -100` to `find . -name '*.ts'`", () => {
    const r = rewriteFind({ command: "find . -name '*.ts'" });
    expect(r?.updatedInput.command).toBe(
      "set -o pipefail; find . -name '*.ts' | awk 'NR<=100'",
    );
    expect(r?.rewriterName).toBe("find");
  });
  it("works for fd too", () => {
    expect(rewriteFind({ command: "fd .ts" })?.updatedInput.command).toBe("set -o pipefail; fd .ts | awk 'NR<=100'");
  });
  it("does NOT rewrite when already piped to head", () => {
    expect(rewriteFind({ command: "find . | head -5" })).toBeNull();
  });
  it("does NOT match `findstr` (Windows command)", () => {
    expect(rewriteFind({ command: "findstr foo bar.txt" })).toBeNull();
  });
});
