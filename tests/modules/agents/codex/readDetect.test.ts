import { describe, expect, it } from "vitest";
import { detectShellRead, unwrapShellArgv } from "../../../../src/modules/agents/codex/readDetect.js";

describe("detectShellRead", () => {
  it.each([
    ["cat src/a.ts", { path: "src/a.ts" }],
    ["cat 'my file.ts'", { path: "my file.ts" }],
    ["type C:\\p\\a.ts", { path: "C:\\p\\a.ts" }],
    ["Get-Content -Raw src/a.ts", { path: "src/a.ts" }],
    ["Get-Content -LiteralPath 'C:/p/a b.ts'", { path: "C:/p/a b.ts" }],
    ["Get-Content -Path src/a.ts -TotalCount 40", { path: "src/a.ts", range: "head:40" }],
    ["gc src/a.ts -Tail 20", { path: "src/a.ts", range: "tail:20" }],
    ["head -n 50 src/a.ts", { path: "src/a.ts", range: "head:50" }],
    ["tail -20 src/a.ts", { path: "src/a.ts", range: "tail:20" }],
    ["sed -n '10,40p' src/a.ts", { path: "src/a.ts", range: "10-40" }],
  ])("%s", (cmd, want) => {
    expect(detectShellRead(cmd)).toEqual(want);
  });

  it.each([
    "cat a.ts b.ts",
    "cat a.ts | head",
    "cat *.ts",
    "Get-Content a.ts | Select-String foo",
    "sed -i 's/a/b/' a.ts",
    "rg foo src",
    "echo hi > a.ts",
    "",
  ])("is not a single-file read: %s", (cmd) => {
    expect(detectShellRead(cmd)).toBeUndefined();
  });

  describe("real Codex PowerShell reads", () => {
    it.each([
      ["Get-Content -Path C:/Users/x/SKILL.md", { path: "C:/Users/x/SKILL.md" }],
      ["Get-Content -LiteralPath 'C:/Users/x/.codex/SKILL.md'", { path: "C:/Users/x/.codex/SKILL.md" }],
      ["Get-Content -Raw 'C:\\Users\\x\\SKILL.md'", { path: "C:\\Users\\x\\SKILL.md" }],
    ])("%s", (cmd, want) => {
      expect(detectShellRead(cmd)).toEqual(want);
    });

    it("Get-ChildItem is a listing, not a read", () => {
      expect(detectShellRead("Get-ChildItem -Force")).toBeUndefined();
    });
  });

  describe("extra cases", () => {
    it.each([
      // flag order must not matter
      ["Get-Content -Raw -Path a.ts", { path: "a.ts" }],
      ["Get-Content -Path a.ts -Raw", { path: "a.ts" }],
      ["Get-Content -Encoding utf8 a.ts", { path: "a.ts" }],
      ["Get-Content -Encoding utf8 -Raw -Path a.ts", { path: "a.ts" }],
      // case-insensitive command and flags
      ["get-content -RAW A.ts", { path: "A.ts" }],
      // quoted Windows path with spaces (backslashes are literal, not escapes)
      ['type "C:\\Program Files\\x\\a.ts"', { path: "C:\\Program Files\\x\\a.ts" }],
      ["type 'C:\\My Docs\\a.ts'", { path: "C:\\My Docs\\a.ts" }],
      // head/tail without a count default to 10 lines
      ["head a.ts", { path: "a.ts", range: "head:10" }],
      ["tail a.ts", { path: "a.ts", range: "tail:10" }],
      // single-line sed print is a one-line range
      ["sed -n '5p' a.ts", { path: "a.ts", range: "5-5" }],
      // surrounding whitespace is ignored
      ["   cat a.ts   ", { path: "a.ts" }],
      ["\n\tcat   a.ts\n", { path: "a.ts" }],
    ])("%j", (cmd, want) => {
      expect(detectShellRead(cmd)).toEqual(want);
    });

    it.each([
      // cat flags change the output (line numbers etc.), so they are not a plain read
      "cat -n a.ts",
      // unterminated quote: do not guess
      "cat 'a.ts",
      'type "C:\\Program Files\\a.ts',
      // unsupported line-number tools
      "nl -ba a.ts",
      // unsupported sed forms
      "sed -n '5,p' a.ts",
      "sed -n '5p;9p' a.ts",
      "sed -n 5,10p a.ts b.ts",
      // flag missing its value or with a non-numeric value
      "Get-Content a.ts -TotalCount",
      "Get-Content a.ts -TotalCount lots",
      "Get-Content -Path",
      "head -n a.ts",
      "head -n 5x a.ts",
      "tail -n +5 a.ts",
      // conflicting ranges
      "Get-Content a.ts -TotalCount 5 -Tail 5",
      // two paths
      "Get-Content -Path a.ts b.ts",
      "head -n 5 a.ts b.ts",
      // unresolved variables and subshells
      "cat $HOME/a.ts",
      "Get-Content $env:USERPROFILE\\a.ts",
      "cat $(pwd)/a.ts",
      // chaining and redirects
      "cat a.ts && cat b.ts",
      "cat a.ts; cat b.ts",
      "cat a.ts > b.ts",
      "cat < a.ts",
      // no file at all
      "cat",
      "Get-Content",
    ])("is not a single-file read: %s", (cmd) => {
      expect(detectShellRead(cmd)).toBeUndefined();
    });
  });
});

describe("unwrapShellArgv", () => {
  it("unwraps bash -lc and powershell -Command", () => {
    expect(unwrapShellArgv(["bash", "-lc", "cat a.ts"])).toBe("cat a.ts");
    expect(unwrapShellArgv(["powershell.exe", "-NoProfile", "-Command", "Get-Content a.ts"])).toBe("Get-Content a.ts");
    expect(unwrapShellArgv(["cat", "a.ts"])).toBe("cat a.ts");
  });

  it("handles other shells, case, and a missing command", () => {
    expect(unwrapShellArgv(["/bin/bash", "-c", "cat a.ts"])).toBe("cat a.ts");
    expect(unwrapShellArgv(["PWSH.EXE", "-NoLogo", "-command", "gc a.ts"])).toBe("gc a.ts");
    expect(unwrapShellArgv(["powershell", "-NoProfile"])).toBe("powershell -NoProfile");
    expect(unwrapShellArgv([])).toBe("");
  });

  it("composes with detectShellRead", () => {
    const cmd = unwrapShellArgv(["powershell.exe", "-Command", "Get-Content -Raw 'C:/p/a.ts'"]);
    expect(detectShellRead(cmd)).toEqual({ path: "C:/p/a.ts" });
  });
});
