import { describe, expect, it } from "vitest";
import { KeyTable } from "../../../src/modules/transcript/dedupe.js";

describe("KeyTable", () => {
  it("maps each key to its insertion slot, like a Map, across growth (ASCII, Unicode, long and empty-ish keys)", () => {
    const t = new KeyTable();
    const ref = new Map<string, number>();
    const keys: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const k =
        i % 7 === 0
          ? `msg_${i}|req_${i}`
          : i % 7 === 1
            ? `codex:é中😀:${i}`
            : i % 7 === 2
              ? "x".repeat(i % 500) + i
              : `resp_${(i * 2654435761) >>> 0}`;
      keys.push(k);
    }
    for (const k of keys) {
      if (ref.has(k)) continue;
      expect(t.get(k)).toBeUndefined();
      const slot = t.add(k);
      ref.set(k, slot);
      expect(slot).toBe(ref.size - 1);
    }
    expect(t.size).toBe(ref.size);
    for (const [k, slot] of ref) expect(t.get(k)).toBe(slot);
    expect(t.get("not there")).toBeUndefined();
    expect(t.get("msg_0|req_")).toBeUndefined();
  });
});
