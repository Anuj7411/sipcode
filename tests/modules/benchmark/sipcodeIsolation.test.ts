import { describe, it, expect } from "vitest";
import {
  strippedSettingsText,
  withSipcodeStripped,
  settingsJsonPath,
  type IsolationIO,
} from "../../../src/modules/benchmark/sipcodeIsolation.js";

function inMemoryIO(initial: Record<string, string> = {}): IsolationIO & {
  files: Map<string, string>;
  writes: { path: string; content: string; sync: boolean }[];
} {
  const files = new Map<string, string>(Object.entries(initial));
  const writes: { path: string; content: string; sync: boolean }[] = [];
  return {
    files,
    writes,
    async read(p) {
      return files.has(p) ? files.get(p)! : null;
    },
    async write(p, content) {
      writes.push({ path: p, content, sync: false });
      files.set(p, content);
    },
    writeSync(p, content) {
      writes.push({ path: p, content, sync: true });
      files.set(p, content);
    },
  };
}

const sipcodeHookEntry = {
  matcher: "*",
  hooks: [
    {
      type: "command",
      command: "~/.claude/hooks/sipcode-proxy.mjs",
      _sipcode_id: "sipcode-proxy",
    },
  ],
};

const claudeMemHookEntry = {
  matcher: "*",
  hooks: [
    {
      type: "command",
      command: "/some/path/claude-mem.mjs",
    },
  ],
};

const settingsWithBoth = {
  hooks: {
    PreToolUse: [sipcodeHookEntry, claudeMemHookEntry],
  },
};

const settingsWithClaudeMemOnly = {
  hooks: {
    PreToolUse: [claudeMemHookEntry],
  },
};

describe("strippedSettingsText", () => {
  it("removes only the Sipcode proxy hook, leaves other hooks intact", () => {
    const out = strippedSettingsText(JSON.stringify(settingsWithBoth));
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.hooks.PreToolUse.length).toBe(1);
    expect(parsed.hooks.PreToolUse[0]).toEqual(claudeMemHookEntry);
  });

  it("returns null when no Sipcode hook is present (no need to touch the file)", () => {
    expect(
      strippedSettingsText(JSON.stringify(settingsWithClaudeMemOnly)),
    ).toBeNull();
  });

  it("returns null on malformed JSON (don't risk modifying a broken file)", () => {
    expect(strippedSettingsText("{not json")).toBeNull();
  });

  it("returns null on non-object root", () => {
    expect(strippedSettingsText(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it("emits trailing newline so editors that add one don't dirty the file", () => {
    const out = strippedSettingsText(JSON.stringify(settingsWithBoth));
    expect(out!.endsWith("\n")).toBe(true);
  });
});

describe("withSipcodeStripped — happy path", () => {
  it("strips before fn, restores after fn, returns fn's value", async () => {
    const originalText = JSON.stringify(settingsWithBoth);
    const io = inMemoryIO({ [settingsJsonPath("/h")]: originalText });
    const seen: string[] = [];
    const result = await withSipcodeStripped(
      "/h",
      async () => {
        seen.push(io.files.get(settingsJsonPath("/h"))!);
        return 42;
      },
      io,
    );
    expect(result).toBe(42);
    // Snapshot during fn does NOT include the Sipcode hook entry
    expect(JSON.parse(seen[0]!).hooks.PreToolUse.length).toBe(1);
    // After: original restored byte-for-byte
    expect(io.files.get(settingsJsonPath("/h"))).toBe(originalText);
  });

  it("no-op when settings file does not exist (no user settings)", async () => {
    const io = inMemoryIO();
    const result = await withSipcodeStripped("/h", async () => 99, io);
    expect(result).toBe(99);
    expect(io.writes.length).toBe(0); // never wrote
  });

  it("no-op when Sipcode hook is not present in settings", async () => {
    const text = JSON.stringify(settingsWithClaudeMemOnly);
    const io = inMemoryIO({ [settingsJsonPath("/h")]: text });
    const result = await withSipcodeStripped("/h", async () => 7, io);
    expect(result).toBe(7);
    expect(io.writes.length).toBe(0);
    expect(io.files.get(settingsJsonPath("/h"))).toBe(text);
  });
});

describe("withSipcodeStripped — error recovery", () => {
  it("restores original when fn throws", async () => {
    const originalText = JSON.stringify(settingsWithBoth);
    const io = inMemoryIO({ [settingsJsonPath("/h")]: originalText });
    await expect(
      withSipcodeStripped(
        "/h",
        async () => {
          throw new Error("boom");
        },
        io,
      ),
    ).rejects.toThrow("boom");
    expect(io.files.get(settingsJsonPath("/h"))).toBe(originalText);
  });

  it("falls back to sync write if async restore fails", async () => {
    const originalText = JSON.stringify(settingsWithBoth);
    const writes: { path: string; sync: boolean }[] = [];
    let asyncWriteCount = 0;
    const io: IsolationIO = {
      async read() {
        return originalText;
      },
      async write(p) {
        asyncWriteCount++;
        if (asyncWriteCount === 2) {
          // Fail the restore async write
          throw new Error("disk full");
        }
        writes.push({ path: p, sync: false });
      },
      writeSync(p) {
        writes.push({ path: p, sync: true });
      },
    };
    await withSipcodeStripped("/h", async () => "ok", io);
    // Should have at least one sync restore write
    expect(writes.some((w) => w.sync)).toBe(true);
  });
});

describe("settingsJsonPath", () => {
  it("returns ~/.claude/settings.json", () => {
    expect(settingsJsonPath("/home/u")).toContain(".claude");
    expect(settingsJsonPath("/home/u").endsWith("settings.json")).toBe(true);
  });
});
