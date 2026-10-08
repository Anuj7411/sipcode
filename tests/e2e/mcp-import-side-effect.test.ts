import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Regression: importing the MCP server module MUST NOT start the server.
 *
 * `sipcode init` imports `getRegisteredMcpToolCount` from mcp/server.js. The
 * server used to call main() + register a `process.stdin.on("end")` handler at
 * module load, so importing it started a server that, under non-TTY stdin (CI,
 * pipes, `init --yes`), saw an immediate EOF and called process.exit(0) —
 * killing the host command (`init`) mid-run. The startup is now guarded behind
 * a main-module check. This test spawns a node process that imports the module
 * with EOF stdin and asserts the server never boots and the process exits 0.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverJs = path.resolve(__dirname, "../../dist/mcp/server.js");

describe("MCP server module is side-effect-free on import", () => {
  it("importing (not run as main) does not start the server or exit the host", () => {
    const url = pathToFileURL(serverJs).href;
    const code = `import(${JSON.stringify(url)}).then((m) => { process.stdout.write("TOOLS=" + m.getRegisteredMcpToolCount() + "\\n"); process.exit(0); });`;
    const r = spawnSync(process.execPath, ["-e", code], {
      input: "", // non-TTY stdin, immediate EOF — the exact bug trigger
      encoding: "utf-8",
      timeout: 20000,
    });
    const output = (r.stdout ?? "") + (r.stderr ?? "");
    expect(output).toContain("TOOLS=15"); // the export is usable
    expect(output).not.toContain("[sipcode-mcp] connected"); // server did NOT boot
    expect(output).not.toContain("stdin closed"); // no exit-on-EOF handler fired
    expect(r.status).toBe(0);
  });
});
