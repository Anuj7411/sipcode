/** An in-memory usage cache for tests: the cache text, and how many times it was replaced. */
import type { UsageCacheIO } from "../../../src/modules/agents/usageSessions.js";

export type MemCache = UsageCacheIO & { text: string | null; writes: number };

export function memCache(): MemCache {
  const c: MemCache = {
    text: null,
    writes: 0,
    async *lines() {
      if (c.text === null) return;
      const lines = c.text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      yield* lines;
    },
    writer() {
      const out: string[] = [];
      return {
        async add(line: string) {
          out.push(line + "\n");
        },
        async commit() {
          c.text = out.join("");
          c.writes++;
        },
        async discard() {
          out.length = 0;
        },
      };
    },
  };
  return c;
}
