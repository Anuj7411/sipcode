import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../../../src/lib/fs.js";
import {
  isObserverProjectDir,
  listAllSessions,
} from "../../../src/modules/transcript/discover.js";

describe("isObserverProjectDir", () => {
  it("matches observer/telemetry project dirs", () => {
    expect(
      isObserverProjectDir("C--Users-ojhaa--claude-mem-observer-sessions"),
    ).toBe(true);
    expect(isObserverProjectDir("something-observer-sessions")).toBe(true);
    expect(isObserverProjectDir("x-claude-mem-observer-anything")).toBe(true);
  });

  it("does not match normal project dirs", () => {
    expect(isObserverProjectDir("C--Projects-Sipcode")).toBe(false);
    expect(isObserverProjectDir("proj-a")).toBe(false);
    // "observer" alone is not enough — needs the -observer-sessions suffix
    // or the claude-mem-observer marker.
    expect(isObserverProjectDir("my-observer-app")).toBe(false);
  });
});

describe("listAllSessions observer exclusion", () => {
  it("skips sessions inside observer project dirs", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/home/u/.claude/projects/real-proj/aaa.jsonl", "{}", 100);
    fs.writeFile(
      "/home/u/.claude/projects/x--claude-mem-observer-sessions/bbb.jsonl",
      "{}",
      100,
    );
    const sessions = await listAllSessions(fs, "/home/u/.claude/projects");
    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toContain("aaa");
    expect(ids).not.toContain("bbb");
  });
});
