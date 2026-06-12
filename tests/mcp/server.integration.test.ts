/**
 * Integration test: spawns the built dist/mcp/server.js as a child process,
 * speaks MCP JSON-RPC over stdio, asserts the basics.
 *
 * This test requires `npm run build` to have produced dist/mcp/server.js.
 * If dist doesn't exist (e.g. fresh clone running test before build), we
 * skip — vitest will report "test.skipped" but the suite stays green.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const SERVER_PATH = path.resolve("dist/mcp/server.js");
const HAS_BUILT_SERVER = existsSync(SERVER_PATH);

interface RpcResult {
  initializeOk: boolean;
  serverName?: string;
  serverVersion?: string;
  tools?: string[];
}

async function runMcpHandshake(timeoutMs = 5000): Promise<RpcResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      child = spawn(process.execPath, [SERVER_PATH], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      reject(e);
      return;
    }

    let stdout = "";
    let resolved = false;
    const result: RpcResult = { initializeOk: false };

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        try {
          child!.kill();
        } catch {
          // ignore
        }
        resolve(result);
      }
    };

    const failHard = (err: Error) => {
      if (!resolved) {
        resolved = true;
        try {
          child!.kill();
        } catch {
          // ignore
        }
        reject(err);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      // Each JSON-RPC response is line-delimited.
      const lines = stdout.split("\n");
      // Keep the last (possibly partial) line in the buffer.
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as {
            id?: number;
            result?: {
              serverInfo?: { name: string; version: string };
              tools?: Array<{ name: string }>;
            };
          };
          if (obj.id === 1 && obj.result?.serverInfo) {
            result.initializeOk = true;
            result.serverName = obj.result.serverInfo.name;
            result.serverVersion = obj.result.serverInfo.version;
            // Immediately send tools/list as request id 2.
            child!.stdin.write(
              JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) +
                "\n",
            );
          }
          if (obj.id === 2 && obj.result?.tools) {
            result.tools = obj.result.tools.map((t) => t.name);
            cleanup();
            return;
          }
        } catch {
          // ignore non-JSON noise
        }
      }
    });

    child.on("error", failHard);
    child.on("exit", () => cleanup());

    // Send initialize as request id 1.
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "sipcode-test", version: "0" },
        },
      }) + "\n",
    );

    setTimeout(cleanup, timeoutMs);
  });
}

describe.skipIf(!HAS_BUILT_SERVER)(
  "MCP server integration (requires `npm run build`)",
  () => {
    let result: RpcResult;

    beforeAll(async () => {
      result = await runMcpHandshake();
    }, 10_000);

    it("answers `initialize` with server name 'sipcode'", () => {
      expect(result.initializeOk).toBe(true);
      expect(result.serverName).toBe("sipcode");
    });

    it("server version is 1.x", () => {
      expect(result.serverVersion).toBeTruthy();
      expect(result.serverVersion?.startsWith("1.")).toBe(true);
    });

    it("registers exactly the fifteen documented tools", () => {
      expect(result.tools).toBeDefined();
      expect(result.tools).toContain("get_sipcode_info");
      expect(result.tools).toContain("list_recent_sessions");
      expect(result.tools).toContain("audit_latest_session");
      expect(result.tools).toContain("get_project_manifest");
      expect(result.tools).toContain("estimate_task_cost");
      expect(result.tools).toContain("verify_sipcode_impact");
      expect(result.tools).toContain("get_proxy_stats");
      expect(result.tools).toContain("get_agent_score");
      expect(result.tools).toContain("get_session_stats");
      expect(result.tools).toContain("install_proxy");
      expect(result.tools).toContain("uninstall_proxy");
      expect(result.tools).toContain("get_proxy_status");
      expect(result.tools).toContain("get_drift_report");
      expect(result.tools).toContain("get_today_summary");
      expect(result.tools).toContain("forecast_monthly_spend");
      expect(result.tools).toHaveLength(15);
    });
  },
);
