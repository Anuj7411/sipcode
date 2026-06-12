/**
 * Proxy hook end-to-end smoke test — validates the generated `.mjs` hook
 * actually works against the compiled `dist/` modules, including B3 AST
 * wiring, without burning real Anthropic credit.
 *
 * What it covers (the gap unit tests can't reach):
 *   1. The generated hook script template, when written to disk and spawned
 *      with PreToolUse JSON on stdin, exits cleanly.
 *   2. A Grep PreToolUse event populates the per-session signal cache.
 *   3. A subsequent Read PreToolUse event for a TS file whose symbol
 *      matches the recorded grep pattern → AST trim fires (stdout contains
 *      updatedInput with offset+limit) AND a stats entry is written.
 *   4. A Read PreToolUse event for a tiny TS file → passthrough (empty stdout).
 *   5. A Read PreToolUse for the SAME file twice (no AST signal) → second
 *      read is deduped (stdout contains permissionDecision: "deny").
 *
 * Each spawn uses a temp HOME so the real ~/.sipcode/ is never touched.
 *
 * Slow-ish (~5s) so excluded from default `npm test` and run via
 * `npm run test:e2e` (or always-on in vitest run for CI gates).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { generateProxyHookScript } from "../../src/modules/proxy/proxyHookScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_PROXY = path.join(REPO_ROOT, "dist", "modules", "proxy");

const runRewriterUrl = pathToFileURL(path.join(DIST_PROXY, "runRewriter.js")).href;
const hookReadDedupUrl = pathToFileURL(path.join(DIST_PROXY, "hookReadDedup.js")).href;
const hookAstReadUrl = pathToFileURL(path.join(DIST_PROXY, "hookAstRead.js")).href;

let workDir: string;
let hookPath: string;
let homeDir: string;
let largeTsPath: string;
let smallTsPath: string;

const SESSION_ID = "smoke-session-aaaa";

function spawnHook(
  input: object,
  envOverrides: Record<string, string> = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(input),
    cwd: workDir,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      ...envOverrides,
    },
    encoding: "utf-8",
    timeout: 10_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

beforeAll(() => {
  // Verify dist exists; this test depends on `npm run build` having been run.
  expect(
    existsSync(path.join(DIST_PROXY, "hookAstRead.js")),
    `dist/modules/proxy/hookAstRead.js missing — run \`npm run build\` first.`,
  ).toBe(true);

  workDir = mkdtempSync(path.join(tmpdir(), "sipcode-hook-smoke-"));
  homeDir = path.join(workDir, "home");
  mkdirSync(homeDir, { recursive: true });

  // Write the generated hook script
  hookPath = path.join(workDir, "sipcode-proxy.mjs");
  writeFileSync(
    hookPath,
    generateProxyHookScript(runRewriterUrl, hookReadDedupUrl, hookAstReadUrl),
    "utf-8",
  );

  // Set up a large synthetic .ts file with a known symbol
  largeTsPath = path.join(workDir, "auth.ts");
  const lines: string[] = [];
  lines.push(`// auth.ts (synthetic 220-line module)`);
  lines.push(`import { Db } from "./db.js";`);
  lines.push(``);
  lines.push(`export function authCheck(userId: string): boolean {`);
  lines.push(`  return userId.length > 0;`);
  lines.push(`}`);
  for (let i = 0; i < 215; i++) lines.push(`// padding ${i}`);
  writeFileSync(largeTsPath, lines.join("\n"), "utf-8");

  // Tiny .ts file (below MIN_LINES_TO_TRIM)
  smallTsPath = path.join(workDir, "tiny.ts");
  writeFileSync(smallTsPath, `export const X = 1;\n`, "utf-8");
});

afterAll(() => {
  try {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const baseInput = (over: Record<string, unknown> = {}) => ({
  session_id: SESSION_ID,
  transcript_path: "/dev/null",
  cwd: workDir,
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "echo hi" },
  ...over,
});

describe("proxy hook smoke — generated script runs cleanly", () => {
  it("exits 0 on a benign Bash event with empty stdout (no rewrite)", () => {
    const { exitCode, stdout, stderr } = spawnHook(baseInput());
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toBe("");
  });

  it("exits 0 on malformed JSON without printing anything", () => {
    const result = spawnSync(process.execPath, [hookPath], {
      input: "{not json",
      cwd: workDir,
      env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect((result.stdout ?? "").trim()).toBe("");
  });
});

describe("proxy hook smoke — signal cache populates from Grep", () => {
  it("Grep PreToolUse event writes a signal entry to ~/.sipcode/proxy-signals/<sid>.jsonl", () => {
    spawnHook(
      baseInput({
        tool_name: "Grep",
        tool_input: { pattern: "authCheck" },
      }),
    );
    const signalsPath = path.join(
      homeDir,
      ".sipcode",
      "proxy-signals",
      `${SESSION_ID}.jsonl`,
    );
    expect(existsSync(signalsPath)).toBe(true);
    const lines = readFileSync(signalsPath, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!);
    expect(last.pattern).toBe("authCheck");
    expect(last.kind).toBe("grep-pattern");
  });
});

describe("proxy hook smoke — AST trim fires after a matching grep", () => {
  it("Read on a large TS file with prior matching grep → updatedInput with offset+limit", () => {
    // The previous test already wrote the 'authCheck' signal. Now Read the file.
    const { exitCode, stdout } = spawnHook(
      baseInput({
        tool_name: "Read",
        tool_input: { file_path: largeTsPath },
      }),
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout.trim()) as {
      hookSpecificOutput: {
        permissionDecision: string;
        updatedInput?: { offset?: number; limit?: number };
      };
    };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(parsed.hookSpecificOutput.updatedInput).toBeDefined();
    expect(typeof parsed.hookSpecificOutput.updatedInput!.offset).toBe("number");
    expect(typeof parsed.hookSpecificOutput.updatedInput!.limit).toBe("number");
    // Slice should be much smaller than the 220-line file.
    expect(parsed.hookSpecificOutput.updatedInput!.limit!).toBeLessThan(60);
  });

  it("a stats entry was written for the ast-read", () => {
    const statsDir = path.join(homeDir, ".sipcode", "proxy-stats");
    expect(existsSync(statsDir)).toBe(true);
    const files = readdirSync(statsDir).filter((f) => f.endsWith(".jsonl"));
    const allEntries: { rewriterName?: string; savedTokensEstimate?: number }[] = [];
    for (const f of files) {
      const raw = readFileSync(path.join(statsDir, f), "utf-8");
      for (const line of raw.split("\n").filter(Boolean)) {
        try {
          allEntries.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }
    }
    const astEntries = allEntries.filter((e) => e.rewriterName === "ast-read");
    expect(astEntries.length).toBeGreaterThan(0);
    expect((astEntries[0]?.savedTokensEstimate ?? 0)).toBeGreaterThan(0);
  });
});

describe("proxy hook smoke — passthrough on small file", () => {
  it("tiny TS file → empty stdout (full file passes through)", () => {
    const { exitCode, stdout } = spawnHook(
      baseInput({
        tool_name: "Read",
        tool_input: { file_path: smallTsPath },
        session_id: "smoke-different-session", // fresh signals (none for this session)
      }),
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
