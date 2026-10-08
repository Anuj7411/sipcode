import { describe, expect, it } from "vitest";
import { detectShellRead, unwrapShellArgv } from "../../../../src/modules/agents/codex/readDetect.js";

describe("detectShellRead", () => {
  it.each([
    ["cat src/a.ts", { path: "src/a.ts" }],
    ["cat 'my file.ts'", { path: "my file.ts" }],
    ["type C:\\p\\a.ts", { path: "C:\\p\\a.ts" }],
    ["Get-Content -Raw src/a.ts", { path: "src/a.ts" }],
    ["Get-Content -LiteralPath 'C:/p/a b.ts'", { path: "C:/p/a b.ts" }],
    ["Get-Content -Path src/a.ts -TotalCount 40", { path: "src/a.ts", range: "1-40" }],
    ["gc src/a.ts -Tail 20", { path: "src/a.ts", range: "tail:20" }],
    ["head -n 50 src/a.ts", { path: "src/a.ts", range: "1-50" }],
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
      ["head a.ts", { path: "a.ts", range: "1-10" }],
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

  describe("multiple files, expansion and path hygiene", () => {
    it.each([
      // PowerShell reads BOTH comma-separated files
      "Get-Content a.ts,b.ts",
      "Get-Content -Path a.ts,b.ts",
      "Get-Content 'a.ts','b.ts'",
      "Get-Content -LiteralPath 'a.ts','b.ts'",
      "cat a.ts,b.ts",
      // bash `type` is a command lookup, not a read
      "type ls",
      "type node",
      // wildcards, braces, brackets, home and cmd.exe variables
      "cat src/{a,b}.ts",
      "cat {a}.ts",
      "cat src/[ab].ts",
      "Get-Content -Path 'src/[ab].ts'",
      "Get-Content 'src/a[1].ts'",
      "cat ~/a.ts",
      "Get-Content ~\\a.ts",
      "type %USERPROFILE%\\a.ts",
      // multi-line commands
      "cat a.ts\nrm b.ts",
      "cat a.ts\r\nGet-Content b.ts",
      "Get-Content a.ts\nGet-Content b.ts",
      // ranges must be sane
      "head -n 0 a.ts",
      "tail -n 0 a.ts",
      "Get-Content a.ts -TotalCount 0",
      "Get-Content a.ts -Tail 0",
      "sed -n '0p' a.ts",
      "sed -n '0,5p' a.ts",
      "sed -n '9,5p' a.ts",
    ])("is not a single-file read: %j", (cmd) => {
      expect(detectShellRead(cmd)).toBeUndefined();
    });

    it.each([
      ["type a.ts", { path: "a.ts" }],
      ["type C:\\p\\a", { path: "C:\\p\\a" }],
      ["type src/a", { path: "src/a" }],
      // brackets are literal under -LiteralPath
      ["Get-Content -LiteralPath 'src/[id]/page.tsx'", { path: "src/[id]/page.tsx" }],
      ["sed -n '5,5p' a.ts", { path: "a.ts", range: "5-5" }],
    ])("%j", (cmd, want) => {
      expect(detectShellRead(cmd)).toEqual(want);
    });
  });

  describe("head ranges normalise to line spans", () => {
    it.each([
      ["head -n 40 a.ts", "1-40"],
      ["head -40 a.ts", "1-40"],
      ["Get-Content a.ts -TotalCount 40", "1-40"],
      ["Get-Content a.ts -Head 40", "1-40"],
      ["Get-Content a.ts -First 40", "1-40"],
      ["Get-Content a.ts | Select-Object -First 40", "1-40"],
      ["sed -n '1,40p' a.ts", "1-40"],
    ])("%s is 1-40-equivalent", (cmd, range) => {
      expect(detectShellRead(cmd)).toEqual({ path: "a.ts", range });
    });

    it("keeps tail symbolic", () => {
      expect(detectShellRead("tail -n 30 a.ts")).toEqual({ path: "a.ts", range: "tail:30" });
      expect(detectShellRead("Get-Content a.ts -Tail 30")).toEqual({ path: "a.ts", range: "tail:30" });
      expect(detectShellRead("Get-Content a.ts | Select-Object -Last 30")).toEqual({ path: "a.ts", range: "tail:30" });
    });
  });

  describe("Select-Object idiom", () => {
    it.each([
      ["Get-Content README.md | Select-Object -First 80", { path: "README.md", range: "1-80" }],
      ["Get-Content -Path 'index.ipynb' | Select-Object -Last 80", { path: "index.ipynb", range: "tail:80" }],
      [
        "Get-Content PredictiveAnalysis.ipynb | Select-Object -Skip 3284 -First 12",
        { path: "PredictiveAnalysis.ipynb", range: "3285-3296" },
      ],
      ["Get-Content a.ts | Select-Object -First 12 -Skip 3284", { path: "a.ts", range: "3285-3296" }],
      ["Get-Content a.ts | Select-Object -Skip 0 -First 5", { path: "a.ts", range: "1-5" }],
      ["gc -LiteralPath 'C:/p/a b.ts' | select-object -first 3", { path: "C:/p/a b.ts", range: "1-3" }],
      ["Get-Content src\\a.py | Select-Object -Skip 10 -First 5", { path: "src\\a.py", range: "11-15" }],
    ])("%s", (cmd, want) => {
      expect(detectShellRead(cmd)).toEqual(want);
    });

    it.each([
      "Get-Content a.ts | Select-Object -Skip 10",
      "Get-Content a.ts | Select-Object -Last 5 -Skip 2",
      "Get-Content a.ts | Select-Object -Last 5 -First 2",
      "Get-Content a.ts | Select-Object -First 0",
      "Get-Content a.ts | Select-Object -First",
      "Get-Content a.ts | Select-Object -First x",
      "Get-Content a.ts | Select-Object -First 5 -First 6",
      "Get-Content a.ts | Select-Object -Property Name -First 5",
      "Get-Content a.ts | Select-Object",
      "Get-Content a.ts | Select-Object -First 5 | Out-String",
      "Get-Content a.ts | Select-Object -First 5; rg foo",
      "Get-Content a.ts | Select-Object -First 5 > out.txt",
      // -Raw emits a single string, so Select-Object does not window by line
      "Get-Content -Raw a.ts | Select-Object -First 5",
      // already partial: ranges would compose, so do not guess
      "Get-Content a.ts -TotalCount 100 | Select-Object -Skip 10 -First 5",
      "Get-Content a.ts,b.ts | Select-Object -First 5",
      "Get-Content *.ts | Select-Object -First 5",
      "Get-Content $f | Select-Object -First 5",
      "Get-Content a.ts | Select-String foo",
      "Get-Content a.ts | Measure-Object -Line",
      "(Get-Content a.ts | Measure-Object -Line).Lines",
      "cat a.ts | Select-Object -First 5",
    ])("is not a single-file read: %s", (cmd) => {
      expect(detectShellRead(cmd)).toBeUndefined();
    });
  });

  describe("numbered whole-file idiom", () => {
    it.each([
      [
        "$i=0; Get-Content src\\matrisk\\data\\materials_enrichment.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
        { path: "src\\matrisk\\data\\materials_enrichment.py" },
      ],
      ["$i=1; Get-Content 'README.md' | ForEach-Object { '{0,4}: {1}' -f $i, $_; $i++ }", { path: "README.md" }],
      ["$i=1; Get-Content 'stock_pipeline.py' | ForEach-Object { '{0,4}: {1}' -f $i, $_; $i++ }", { path: "stock_pipeline.py" }],
      ["$i=0; gc -LiteralPath 'C:/p/a b.py' | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }", { path: "C:/p/a b.py" }],
      ["$i=0; Get-Content -Raw -Path a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }", { path: "a.py" }],
      ["  $i=0;  Get-Content a.py|ForEach-Object{ $i++; '{0,4}: {1}' -f $i, $_ }  ", { path: "a.py" }],
    ])("%s", (cmd, want) => {
      expect(detectShellRead(cmd)).toEqual(want);
    });

    it.each([
      // extra pipelines or commands in the body
      "$i=0; Get-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ } | Select-String foo",
      "$i=0; Get-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ | Out-File b.txt }",
      "$i=0; Get-Content a.py | ForEach-Object { $i++; Remove-Item b.txt; '{0,4}: {1}' -f $i, $_ }",
      "$i=0; Get-Content a.py | ForEach-Object { $i++; $i++; '{0,4}: {1}' -f $i, $_ }",
      "$i=0; Get-Content a.py | ForEach-Object { '{0,4}: {1}' -f $i, $_ > b.txt }",
      "$i=0; Get-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }; rg foo",
      "$i=0; Get-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }; Remove-Item a.py",
      "$i=0; Get-Content a.py | ForEach-Object { $i++; \"{0,4}: {1}\" -f $i, $_ }",
      "$i=0; Get-Content a.py | ForEach-Object { $i++; '$(Remove-Item x)' -f $i, $_ }",
      "$i=0; Get-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_.ToUpper() }",
      // not the exact prefix
      "$i=x; Get-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
      "Get-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
      "$i=0; Remove-Item b; Get-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
      // paths and ranges
      "$i=0; Get-Content a.py,b.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
      "$i=0; Get-Content *.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
      "$i=0; Get-Content a.py -TotalCount 5 | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
      "$i=0; Get-Content | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
      // multi-line
      "$i=0\nGet-Content a.py | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }",
      "$i=0; Get-Content a.py | ForEach-Object {\n $i++; '{0,4}: {1}' -f $i, $_\n}",
      // line-window loops are not supported
      "$lines = Get-Content a.py; for ($i=220; $i -le 340; $i++) { '{0,4}: {1}' -f $i, $lines[$i-1] }",
    ])("is not a single-file read: %j", (cmd) => {
      expect(detectShellRead(cmd)).toBeUndefined();
    });
  });
});

describe("unwrapShellArgv", () => {
  it("joins every argument after -Command", () => {
    expect(unwrapShellArgv(["powershell.exe", "-NoProfile", "-Command", "Get-Content", "a.ts"])).toBe("Get-Content a.ts");
    expect(unwrapShellArgv(["pwsh", "-c", "Get-Content", "-Raw", "a.ts"])).toBe("Get-Content -Raw a.ts");
  });

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
