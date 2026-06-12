/**
 * Release smoke test — the gate that runs BEFORE every npm publish.
 *
 * Without this gate, the last 5 production bugs all shipped to users:
 *   - sipcode-mcp@latest 404 (README config didn't actually work)
 *   - SERVER_VERSION hardcoded at "1.1.0" (lied about the running version)
 *   - v1.0.0 published without fonts/pricing in dist/
 *   - recommend.ts hardcoded to base SKUs after PREDICTION_MODELS changed
 *   - npm 10.x vs OIDC publishing requiring 11+
 *
 * Every one of these passed `npm test` and still broke real users.
 *
 * This file simulates a REAL user install end-to-end:
 *   1. `npm pack` produces the exact tarball that would be published.
 *   2. Install that tarball in a clean temp directory (the way
 *      `npm install -g` would unpack it).
 *   3. Run every documented binary and verify the MCP server boots.
 *   4. Fail loudly if anything's off.
 *
 * CI wires this into release.yml BEFORE the `npm publish` step. A failed
 * smoke test BLOCKS the publish — bugs cannot reach users.
 *
 * Slow (~30-60s) so excluded from default `npm test`. Run via:
 *   npm run test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { tmpdir, platform } from "node:os";
import path from "node:path";

const IS_WINDOWS = platform() === "win32";
// Bypass `.cmd` shims entirely. Three reasons:
//   1. DEP0190 — `spawn(cmd, [args], { shell: true })` is deprecated in
//      Node 22 and will hard-error in a future major. The old workaround
//      (`shell: IS_WINDOWS`) is the deprecated path.
//   2. `spawnSync('npm.cmd', [...], { shell: false })` returns EINVAL on
//      Windows — Node can't natively launch .cmd batch shims.
//   3. Direct `node + script.js` is faster (no cmd.exe startup) and
//      identical on every platform — better test signal.
// `process.execPath` is the absolute path to the Node binary currently
// running the test. npm ships in a deterministic location relative to it.
const NPM_CLI_JS = path.join(
  path.dirname(process.execPath),
  ...(IS_WINDOWS ? [] : ["..", "lib"]),
  "node_modules",
  "npm",
  "bin",
  "npm-cli.js",
);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PKG_JSON = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8"),
) as { version: string; name: string };
const EXPECTED_VERSION = PKG_JSON.version;

let installDir: string;
let tarballPath: string;
let sipcodeBin: string;     // .cmd / symlink — existence-checked, not spawned
let sipcodeMcpBin: string;  // .cmd / symlink — existence-checked, not spawned
let sipcodeCliJs: string;   // direct JS entry — what we spawn (no shell)
let sipcodeMcpJs: string;   // direct JS entry — what we spawn (no shell)
let pkgRoot: string;        // node_modules/sipcode/

beforeAll(async () => {
  // 1. npm pack — produce the exact tarball that would be published
  const pack = spawnSync(
    process.execPath,
    [NPM_CLI_JS, "pack", "--silent"],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (pack.status !== 0) {
    throw new Error(`npm pack failed: ${pack.stderr}`);
  }
  const tarballName = pack.stdout.trim().split(/\r?\n/).pop()!;
  tarballPath = path.join(REPO_ROOT, tarballName);
  if (!existsSync(tarballPath)) {
    throw new Error(`tarball not found at ${tarballPath}`);
  }

  // 2. Install into a fresh tmpdir
  installDir = mkdtempSync(path.join(tmpdir(), "sipcode-smoke-"));
  writeFileSync(
    path.join(installDir, "package.json"),
    JSON.stringify({ name: "smoke-host", version: "0.0.0", private: true }),
  );

  const install = spawnSync(
    process.execPath,
    [NPM_CLI_JS, "install", "--no-save", "--no-audit", "--no-fund", tarballPath],
    {
      cwd: installDir,
      encoding: "utf-8",
    },
  );
  if (install.status !== 0) {
    throw new Error(
      `npm install failed (status ${install.status}):\nstderr=${install.stderr}\nstdout=${install.stdout}`,
    );
  }

  pkgRoot = path.join(installDir, "node_modules", "sipcode");
  const binDir = path.join(installDir, "node_modules", ".bin");
  sipcodeBin = path.join(binDir, IS_WINDOWS ? "sipcode.cmd" : "sipcode");
  sipcodeMcpBin = path.join(binDir, IS_WINDOWS ? "sipcode-mcp.cmd" : "sipcode-mcp");
  // Direct JS entry points — what `sipcode.cmd` and `sipcode-mcp.cmd`
  // ultimately exec. We invoke these via `process.execPath` to avoid
  // every .cmd-shim pitfall (DEP0190, EINVAL, slow cmd.exe startup).
  sipcodeCliJs = path.join(pkgRoot, "dist", "cli.js");
  sipcodeMcpJs = path.join(pkgRoot, "dist", "mcp", "server.js");
}, 180_000);

afterAll(() => {
  if (installDir && existsSync(installDir)) {
    rmSync(installDir, { recursive: true, force: true });
  }
  if (tarballPath && existsSync(tarballPath)) {
    rmSync(tarballPath, { force: true });
  }
});

describe("release smoke — tarball contents", () => {
  it("tarball exists with reasonable size (100KB-10MB)", () => {
    const stats = statSync(tarballPath);
    expect(stats.size).toBeGreaterThan(100_000);
    expect(stats.size).toBeLessThan(10_000_000);
  });

  it("installs both binaries", () => {
    expect(existsSync(sipcodeBin)).toBe(true);
    expect(existsSync(sipcodeMcpBin)).toBe(true);
  });

  it("installs the compiled MCP server", () => {
    expect(existsSync(path.join(pkgRoot, "dist", "mcp", "server.js"))).toBe(true);
  });

  it("includes pricing JSON [v1.0.0 bug regression guard]", () => {
    expect(
      existsSync(path.join(pkgRoot, "dist", "lib", "pricing", "2026-05-01.json")),
    ).toBe(true);
  });

  it("includes receipt fonts [v1.0.0 bug regression guard]", () => {
    const fontDir = path.join(pkgRoot, "dist", "modules", "receipt", "assets", "fonts");
    expect(existsSync(path.join(fontDir, "Inter-Regular.ttf"))).toBe(true);
    expect(existsSync(path.join(fontDir, "Inter-Bold.ttf"))).toBe(true);
    expect(existsSync(path.join(fontDir, "JetBrainsMono-Medium.ttf"))).toBe(true);
  });

  it("does NOT include tests/ in published tarball", () => {
    expect(existsSync(path.join(pkgRoot, "tests"))).toBe(false);
  });
});

describe("release smoke — sipcode CLI binary", () => {
  it("--version returns the actual package version [hardcoded-version bug regression guard]", () => {
    const r = spawnSync(process.execPath, [sipcodeCliJs, "--version"], {
      encoding: "utf-8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(EXPECTED_VERSION);
  });

  it("--help lists every documented command", () => {
    const r = spawnSync(process.execPath, [sipcodeCliJs, "--help"], {
      encoding: "utf-8",
    });
    expect(r.status).toBe(0);
    for (const cmd of [
      "why",
      "init",
      "manifest",
      "receipt",
      "rules",
      "estimate",
      "stats",
      "score",
      "hygiene",
      "benchmark",
    ]) {
      expect(r.stdout).toContain(cmd);
    }
  });
});

describe("release smoke — sipcode-mcp binary [THE gate for MCP bugs]", () => {
  it(
    "boots and reports the actual package version [SERVER_VERSION hardcoded bug regression guard]",
    async () => {
      const r = await mcpHandshake(sipcodeMcpJs);
      expect(r.startupLog).toContain("connected");
      expect(r.startupLog).toContain(`v${EXPECTED_VERSION}`);
      expect(r.startupLog).toContain("15 tools");
    },
    20_000,
  );

  it(
    "registers exactly the 15 documented MCP tools",
    async () => {
      const r = await mcpHandshake(sipcodeMcpJs);
      expect(r.toolNames.sort()).toEqual(
        [
          "audit_latest_session",
          "estimate_task_cost",
          "forecast_monthly_spend",
          "get_agent_score",
          "get_drift_report",
          "get_project_manifest",
          "get_proxy_stats",
          "get_proxy_status",
          "get_session_stats",
          "get_sipcode_info",
          "get_today_summary",
          "install_proxy",
          "list_recent_sessions",
          "uninstall_proxy",
          "verify_sipcode_impact",
        ],
      );
    },
    20_000,
  );

  it(
    "each tool has a description and an input schema",
    async () => {
      const r = await mcpHandshake(sipcodeMcpJs);
      for (const tool of r.tools) {
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    },
    20_000,
  );
});

describe("release smoke — privacy guard preserved in published tarball", () => {
  it("compiled dist/ has no runtime network imports outside lib/fs.js", () => {
    const distRoot = path.join(pkgRoot, "dist");
    const violations: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".js")) continue;
        const rel = path.relative(distRoot, full);
        // lib/fs.js is the only seam allowed network primitives (it has none today)
        if (rel.endsWith(path.join("lib", "fs.js"))) continue;
        const src = readFileSync(full, "utf-8");
        if (/require\(['"]node:(http|https|net|dgram|tls|dns)['"]\)/.test(src)) {
          violations.push(`${rel}: forbidden require()`);
        }
        if (/from ['"]node:(http|https|net|dgram|tls|dns)['"]/.test(src)) {
          violations.push(`${rel}: forbidden import`);
        }
      }
    };

    walk(distRoot);
    expect(violations).toEqual([]);
  });
});

/* ============================================================
 *  MCP handshake helper — clean async version
 * ============================================================ */

interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: string };
}

interface HandshakeResult {
  readonly startupLog: string;
  readonly tools: ToolDef[];
  readonly toolNames: string[];
}

/**
 * Spawn the MCP server binary, complete the JSON-RPC handshake, request
 * tools/list, return what we got. Kills the child after.
 */
async function mcpHandshake(serverJs: string): Promise<HandshakeResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      // Direct `node + dist/mcp/server.js` — same code path the
      // `.cmd` shim runs, minus the shim. DEP0190-free, cross-platform.
      child = spawn(process.execPath, [serverJs], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      reject(e);
      return;
    }

    let stdoutBuf = "";
    let startupLog = "";
    let resolved = false;

    const finish = (val: HandshakeResult) => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(val);
    };

    const fail = (err: Error) => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(err);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf-8");
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as {
            id?: number;
            result?: { tools?: ToolDef[] };
          };
          if (obj.id === 2 && obj.result?.tools) {
            const tools = obj.result.tools;
            finish({
              startupLog,
              tools,
              toolNames: tools.map((t) => t.name),
            });
            return;
          }
        } catch {
          // skip non-JSON
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      startupLog += chunk.toString("utf-8");
    });

    child.on("error", (err) => fail(err));
    child.on("exit", (code) => {
      if (!resolved) {
        fail(
          new Error(
            `MCP server exited (code=${code}) before handshake completed. stderr=${startupLog}`,
          ),
        );
      }
    });

    // Send initialize, then (after a tick) tools/list
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "release-smoke", version: "0" },
        },
      }) + "\n",
    );
    setTimeout(() => {
      if (resolved) return;
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n",
      );
    }, 800);

    // Hard timeout
    setTimeout(() => {
      fail(new Error(`MCP handshake timed out after 10s. stderr=${startupLog}`));
    }, 10_000);
  });
}
