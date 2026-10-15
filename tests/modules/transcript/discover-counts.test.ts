/** Claude Code discovery counts what it could not read (never drops it silently). */
import { describe, expect, it } from "vitest";
import { InMemoryFs, type FileSystem } from "../../../src/lib/fs.js";
import { listAllSessions, listClaudeSessions } from "../../../src/modules/transcript/discover.js";

/** Throws EACCES for the operations and paths `fail` names. */
function failing(base: InMemoryFs, fail: (p: string, op: string) => boolean): FileSystem {
  const guard = (p: string, op: string) => {
    if (fail(p.replace(/\\/g, "/"), op)) throw Object.assign(new Error(`EACCES: ${p}`), { code: "EACCES" });
  };
  return {
    exists: (p) => base.exists(p),
    readFile: async (p) => (guard(p, "readFile"), base.readFile(p)),
    readHead: async (p, n) => (guard(p, "readHead"), base.readHead(p, n)),
    readBytes: async (p) => (guard(p, "readBytes"), base.readBytes(p)),
    readDir: async (p) => (guard(p, "readDir"), base.readDir(p)),
    stat: async (p) => (guard(p, "stat"), base.stat(p)),
  };
}

function logs(): InMemoryFs {
  const fs = new InMemoryFs();
  fs.writeFile("/p/A/one.jsonl", "{}", 2);
  fs.writeFile("/p/B/two.jsonl", "{}", 1);
  return fs;
}

describe("listClaudeSessions", () => {
  it("lists every session, newest first, with zero counts", async () => {
    const r = await listClaudeSessions(logs(), "/p");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["one", "two"]);
    expect(r.unreadable).toBe(0);
    expect(r.unreadableFolders).toBe(0);
  });

  it("a missing projects folder is not an error", async () => {
    expect(await listClaudeSessions(new InMemoryFs(), "/none")).toEqual({ sessions: [], unreadable: 0, unreadableFolders: 0 });
  });

  it("counts a projects folder that cannot be listed", async () => {
    const r = await listClaudeSessions(failing(logs(), (p, op) => op === "readDir" && p === "/p"), "/p");
    expect(r).toEqual({ sessions: [], unreadable: 0, unreadableFolders: 1 });
  });

  it("counts a project folder that cannot be listed and keeps the others", async () => {
    const r = await listClaudeSessions(failing(logs(), (p, op) => op === "readDir" && p === "/p/B"), "/p");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["one"]);
    expect(r.unreadableFolders).toBe(1);
  });

  it("counts a transcript that cannot be read", async () => {
    const r = await listClaudeSessions(failing(logs(), (p, op) => op === "stat" && p.endsWith("two.jsonl")), "/p");
    expect(r.sessions.map((s) => s.sessionId)).toEqual(["one"]);
    expect(r.unreadable).toBe(1);
  });

  it("listAllSessions returns the same sessions", async () => {
    expect((await listAllSessions(logs(), "/p")).map((s) => s.sessionId)).toEqual(["one", "two"]);
  });
});
