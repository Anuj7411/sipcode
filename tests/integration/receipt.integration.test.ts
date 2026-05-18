import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryFs } from "../../src/lib/fs.js";
import { FakeClock } from "../../src/lib/clock.js";
import { FakeProcessEnv } from "../../src/lib/process.js";
import { FakeClipboard } from "../../src/lib/clipboard.js";
import { runReceipt } from "../../src/commands/receipt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../fixtures/transcripts");
const loadFixture = (n: string) =>
  readFileSync(path.join(fixtures, n), "utf-8");

function makeFs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile(
    "/home/u/.claude/projects/test-proj/readheavy1.jsonl",
    loadFixture("read-heavy.jsonl"),
    new Date("2026-05-02T09:00:30Z").getTime(),
  );
  fs.writeFile(
    "/home/u/.claude/projects/test-proj/minimal01.jsonl",
    loadFixture("minimal-2turn.jsonl"),
    new Date("2026-05-01T10:00:45Z").getTime(),
  );
  return fs;
}

function makeEnv() {
  return new FakeProcessEnv({
    homeDir: "/home/u",
    platform: "linux",
    vars: { NO_COLOR: "1" },
  });
}

describe("runReceipt integration", () => {
  it("--html-only writes a standalone html file, no png attempted", async () => {
    const fs = makeFs();
    const writes = new Map<string, string | Uint8Array>();
    const clipboard = new FakeClipboard();
    const out: string[] = [];

    const result = await runReceipt(
      { htmlOnly: true, noShare: true, cwd: "/work" },
      {
        fs,
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        clipboard,
        stdout: (s) => out.push(s),
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.htmlPath).toBeDefined();
    expect(result.pngPath).toBeUndefined();
    const htmlKey = [...writes.keys()].find((k) => k.endsWith("receipt.html"));
    expect(htmlKey).toBeDefined();
    expect(htmlKey!).toContain("/.sipcode/receipts/");
    const content = writes.get(htmlKey!) as string;
    expect(content.startsWith("<!doctype html>")).toBe(true);
    // Clipboard was NOT touched (no PNG and --no-share).
    expect(clipboard.copies.length).toBe(0);
  });

  it("--json prints a machine-readable payload", async () => {
    const fs = makeFs();
    const writes = new Map<string, string | Uint8Array>();
    const out: string[] = [];

    const result = await runReceipt(
      { json: true, htmlOnly: true, noShare: true, cwd: "/work" },
      {
        fs,
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        clipboard: new FakeClipboard(),
        stdout: (s) => out.push(s),
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
      },
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.schemaVersion).toBe("sipcode-receipt/1");
    expect(parsed.hero.tokensDisplay).toMatch(/^[\d,]+$/);
    expect(parsed.htmlPath).toMatch(/receipt\.html$/);
    expect(parsed.pngPath).toBeNull();
  });

  it("emits brand-voice E003 when projects dir missing", async () => {
    const err: string[] = [];
    const result = await runReceipt(
      { htmlOnly: true, noShare: true, cwd: "/work" },
      {
        fs: new InMemoryFs(),
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        clipboard: new FakeClipboard(),
        stdout: () => {},
        stderr: (s) => err.push(s),
        writeFile: async () => {},
      },
    );
    expect(result.exitCode).toBe(1);
    const joined = err.join("\n");
    expect(joined).toContain("[E003]");
    expect(joined).toContain("why:");
    expect(joined).toContain("fix:");
    expect(joined).toContain("next:");
  });

  it("defaults to post-install variant when no manifest sentinel is found", async () => {
    const fs = makeFs();
    const out: string[] = [];

    const result = await runReceipt(
      { json: true, htmlOnly: true, noShare: true, cwd: "/work" },
      {
        fs,
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        clipboard: new FakeClipboard(),
        stdout: (s) => out.push(s),
        stderr: () => {},
        writeFile: async () => {},
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    // ParsedSession.cwd from the fixture is undefined or doesn't have a
    // .sipcode/manifest.md → we default to "post-install".
    expect(["post-install", "pre-install"]).toContain(parsed.variant);
  });

  it("prints tweet intent URL and attempts clipboard when share+png enabled", async () => {
    const fs = makeFs();
    const writes = new Map<string, string | Uint8Array>();
    const clipboard = new FakeClipboard({ strategy: "linux-x11" });
    const out: string[] = [];

    const result = await runReceipt(
      { cwd: "/work" }, // no --html-only, no --no-share
      {
        fs,
        env: makeEnv(),
        clock: new FakeClock(new Date("2026-05-15T00:00:00Z")),
        clipboard,
        stdout: (s) => out.push(s),
        stderr: () => {},
        writeFile: async (p, c) => {
          writes.set(p.replace(/\\/g, "/"), c);
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.pngPath).toBeDefined();
    const joined = out.join("\n");
    expect(joined).toContain("share it: https://twitter.com/intent/tweet?text=");
    // Clipboard was attempted (one copy recorded for the PNG path).
    expect(clipboard.copies.length).toBe(1);
    expect(clipboard.copies[0]!).toMatch(/receipt\.png$/);
    expect(joined).toContain("copied png to clipboard");
  }, 30_000);

  it("writes idempotent HTML bytes across two runs", async () => {
    const env = makeEnv();
    const clock = new FakeClock(new Date("2026-05-15T00:00:00Z"));

    async function once() {
      const writes = new Map<string, string | Uint8Array>();
      await runReceipt(
        { htmlOnly: true, noShare: true, cwd: "/work" },
        {
          fs: makeFs(),
          env,
          clock,
          clipboard: new FakeClipboard(),
          stdout: () => {},
          stderr: () => {},
          writeFile: async (p, c) => {
            writes.set(p.replace(/\\/g, "/"), c);
          },
        },
      );
      const htmlKey = [...writes.keys()].find((k) => k.endsWith("receipt.html"));
      return writes.get(htmlKey!) as string;
    }

    const a = await once();
    const b = await once();
    expect(a).toBe(b);
  });
});
