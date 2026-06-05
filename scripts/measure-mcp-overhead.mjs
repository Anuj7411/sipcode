// Measures the REAL token cost of Sipcode's MCP tool schemas (the per-turn
// "stateless tax"), and what consolidating 12 tools -> 4 would actually save.
// Approx tokens via a JSON-aware heuristic (~chars/3.7, close to cl100k for JSON).
import { spawn } from "node:child_process";

const serverJs = process.argv[2] ?? "dist/mcp/server.js";
const child = spawn(process.execPath, [serverJs], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
child.stdout.on("data", (c) => {
  buf += c.toString("utf-8");
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o.id && pending.has(o.id)) { pending.get(o.id)(o); pending.delete(o.id); } } catch {}
  }
});
child.stderr.on("data", () => {});
const rpc = (id, method, params) => new Promise((res) => { pending.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });

const approxTokens = (s) => Math.round(s.length / 3.7);

await rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "measure", version: "0" } });
const list = await rpc(2, "tools/list");
const tools = list.result.tools;

// Exactly what the client injects into the system prompt each turn: the tool defs.
const currentPayload = JSON.stringify(tools);
const currentTokens = approxTokens(currentPayload);

console.log(`CURRENT: ${tools.length} tools`);
for (const t of tools) {
  const tk = approxTokens(JSON.stringify(t));
  console.log(`  ${t.name.padEnd(24)} ~${tk} tok`);
}
console.log(`CURRENT TOTAL: ~${currentTokens} tokens/turn (${currentPayload.length} chars)`);

// Hypothetical consolidated surface: 4 tools, everything still model-callable.
const consolidated = [
  { name: "sipcode_proxy", description: "Manage the Sipcode runtime token-optimizer proxy in Claude Code: install it, uninstall it, check status, or report rewrite stats.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["install", "uninstall", "status", "stats"], description: "What to do with the proxy." } }, required: ["action"] } },
  { name: "sipcode_audit", description: "Run a Sipcode token-usage analysis: audit the latest session, A/B before-vs-after impact, cross-session stats, or a codebase agent-friendliness score.", inputSchema: { type: "object", properties: { what: { type: "string", enum: ["last_session", "impact", "stats", "score"], description: "Which analysis to run." }, cwd: { type: "string", description: "Project path (for impact/score)." } }, required: ["what"] } },
  { name: "sipcode_estimate", description: "Predict what a coding task will cost across Claude models before running it.", inputSchema: { type: "object", properties: { task: { type: "string" }, cwd: { type: "string" } }, required: ["task", "cwd"] } },
  { name: "sipcode_info", description: "Return Sipcode version, registered capabilities, and runtime info.", inputSchema: { type: "object", properties: {} } },
];
const consolidatedPayload = JSON.stringify(consolidated);
const consolidatedTokens = approxTokens(consolidatedPayload);
console.log(`\nCONSOLIDATED: ${consolidated.length} tools -> ~${consolidatedTokens} tokens/turn (${consolidatedPayload.length} chars)`);
const pct = Math.round((1 - consolidatedTokens / currentTokens) * 100);
console.log(`REDUCTION: ~${pct}% (everything still callable by Claude — no features lost)`);

child.kill();
process.exit(0);
