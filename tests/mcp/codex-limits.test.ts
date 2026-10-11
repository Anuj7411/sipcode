/** MCP get_codex_limits: the JSON of `sipcode limits --json`, with an optional `since`. */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { callTool, listToolDefinitions, type McpToolDeps } from "../../src/mcp/server.js";
import { runLimits } from "../../src/commands/limits.js";
import { addShrinkScenario, addWeeklyLimitScenario } from "../integration/codex-fixtures.js";

function deps(fs: InMemoryFs, now: string): McpToolDeps {
  return {
    fs,
    env: new FakeProcessEnv({ homeDir: "/home/u", platform: "linux", vars: { NO_COLOR: "1" } }),
    clock: new FakeClock(new Date(now)),
    cwd: "/w",
  };
}

async function call(args: Record<string, unknown>, fs: InMemoryFs, now = "2026-10-09T10:00:00.000Z") {
  const r = await callTool("get_codex_limits", args, deps(fs, now));
  const texts = r.content.map((c) => (c.type === "text" ? c.text : ""));
  return { isError: r.isError === true, texts, text: texts[0] ?? "" };
}

describe("get_codex_limits", () => {
  it("is registered with an optional since and no agent input", () => {
    const def = listToolDefinitions().find((d) => d.name === "get_codex_limits");
    expect(def).toBeDefined();
    const props = (def!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(["since"]);
    expect(def!.description).toContain("Codex");
  });

  it("returns the limits --json output as one text item", async () => {
    const fs = new InMemoryFs();
    addWeeklyLimitScenario(fs);
    const r = await call({}, fs);
    expect(r.isError).toBe(false);
    expect(r.texts).toHaveLength(1);
    const j = JSON.parse(r.text);
    expect(j.agent).toBe("codex");
    expect(j.windows[0].usedPercent).toBe(62);
    expect(j.windows[0].label).toBe("Weekly");
  });

  it("the text is exactly what limits --json prints, with and without since", async () => {
    const now = "2026-10-09T00:00:00.000Z";
    for (const args of [{}, { since: "all" }]) {
      const fs = new InMemoryFs();
      addShrinkScenario(fs);
      addWeeklyLimitScenario(fs);
      const out: string[] = [];
      const d = deps(fs, now);
      await runLimits({ json: true, cwd: "/w", ...args }, { fs, env: d.env!, clock: d.clock!, stdout: (s) => out.push(s), stderr: () => {} });
      expect((await call(args, fs, now)).text).toBe(out.join("\n"));
    }
  });

  it("since narrows the tokens-per-1% history", async () => {
    const fs = new InMemoryFs();
    addShrinkScenario(fs);
    const all = JSON.parse((await call({}, fs, "2026-10-09T00:00:00.000Z")).text);
    expect(all.windows[0].possibleCut).toEqual({ at: "2026-09-15", factor: 4 });
    const recent = JSON.parse((await call({ since: "7d" }, fs, "2026-10-09T00:00:00.000Z")).text);
    expect(recent.windows[0].tokensPerPercent).toEqual([]);
  });

  it("no Codex logs: an empty windows list, not an error", async () => {
    const r = await call({}, new InMemoryFs());
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text)).toEqual({ agent: "codex", planType: null, asOf: null, windows: [] });
  });

  it("a bad since is a tool error with the E010 message", async () => {
    const fs = new InMemoryFs();
    addWeeklyLimitScenario(fs);
    const r = await call({ since: "yesterday" }, fs);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("[E010]");
  });

  it("a since that is not a string is an argument error", async () => {
    const r = await call({ since: 5 }, new InMemoryFs());
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Invalid arguments for get_codex_limits: since/);
  });
});
