// Drives the REAL MCP server over stdio JSON-RPC and calls the new tools.
// Usage: node scripts/verify-mcp.mjs <serverJs>
import { spawn } from "node:child_process";

const serverJs = process.argv[2];
const child = spawn(process.execPath, [serverJs], { stdio: ["pipe", "pipe", "pipe"] });

let buf = "";
const pending = new Map();
child.stdout.on("data", (c) => {
  buf += c.toString("utf-8");
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.id && pending.has(obj.id)) {
        pending.get(obj.id)(obj);
        pending.delete(obj.id);
      }
    } catch { /* skip */ }
  }
});
child.stderr.on("data", () => {});

function rpc(id, method, params) {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function call(id, name, args = {}) {
  return rpc(id, "tools/call", { name, arguments: args });
}
function text(r) {
  const t = r?.result?.content?.[0]?.text ?? JSON.stringify(r?.error ?? r);
  return t.slice(0, 200).replace(/\n/g, " ⏎ ");
}

await rpc(1, "initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "verify-mcp", version: "0" },
});

const status1 = await call(2, "get_proxy_status");
console.log("get_proxy_status (before):", text(status1));

const install = await call(3, "install_proxy");
console.log("install_proxy:", text(install));

const status2 = await call(4, "get_proxy_status");
console.log("get_proxy_status (after):", text(status2));

const stats = await call(5, "get_proxy_stats");
console.log("get_proxy_stats:", text(stats));

const uninstall = await call(6, "uninstall_proxy");
console.log("uninstall_proxy:", text(uninstall));

const sessionStats = await call(7, "get_session_stats");
console.log("get_session_stats:", text(sessionStats));

child.kill();
process.exit(0);
