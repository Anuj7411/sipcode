// Verification harness — drives the REAL generated hook process per case.
// Usage: node scripts/verify-proxy.mjs <hookPath>
import { spawn } from "node:child_process";

const hookPath = process.argv[2];
if (!hookPath) {
  console.error("usage: node verify-proxy.mjs <hookPath>");
  process.exit(2);
}

const base = {
  session_id: "s",
  transcript_path: "/t",
  cwd: "/c",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
};

const cases = [
  ["Bash", { command: "git status" }],
  ["Bash", { command: "git status -uno" }],            // extra flag present
  ["Bash", { command: "git status -s" }],              // already short
  ["Bash", { command: "echo hi && git status" }],      // git mid-chain
  ["Bash", { command: "git status && echo done" }],    // git leads chain
  ["Bash", { command: "git log" }],
  ["Bash", { command: "npm ls" }],
  ["Bash", { command: "ls /tmp" }],
  ["Bash", { command: "ls && git status" }],           // ls leads chain
  ["Bash", { command: "ls | wc -l" }],                 // ls already piped
  ["Bash", { command: "grep -r foo ." }],
  ["Bash", { command: "grep -rl foo ." }],             // list mode (the fix)
  ["Bash", { command: "cat small.txt" }],              // head+tail overlap risk
  ["Bash", { command: "cat a.txt b.txt" }],            // multi-file
  ["Bash", { command: "echo nothing to do here" }],    // no match
  ["Read", { file_path: "/x.ts" }],                    // limit injection
  ["Read", { file_path: "/x.ts", limit: 50 }],         // explicit limit
  ["Read", { file_path: "/photo.png" }],               // image
  ["Grep", { pattern: "foo" }],                        // head_limit injection
  ["Glob", { pattern: "**/*.ts" }],
  ["WebFetch", { url: "https://x" }],                  // unknown tool
];

function runHook(payload) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [hookPath], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
    p.stdin.write(JSON.stringify(payload));
    p.stdin.end();
  });
}

for (const [tool, input] of cases) {
  const r = await runHook({ ...base, tool_name: tool, tool_input: input });
  let rewrite = "(no rewrite)";
  if (r.out.trim()) {
    try {
      const j = JSON.parse(r.out);
      const ui = j.hookSpecificOutput?.updatedInput;
      rewrite = JSON.stringify(ui);
    } catch {
      rewrite = "PARSE-FAIL: " + r.out.slice(0, 80);
    }
  }
  const label = `${tool} ${JSON.stringify(input)}`.padEnd(46);
  const flag = r.code !== 0 ? ` [exit ${r.code}]` : "";
  console.log(`${label} -> ${rewrite}${flag}`);
  if (r.err.trim()) console.log(`   STDERR: ${r.err.trim().slice(0, 120)}`);
}
