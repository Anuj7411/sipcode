import { describe, expect, it } from "vitest";
import {
  all,
  err,
  flatMap,
  isErr,
  isOk,
  map,
  ok,
} from "../../src/lib/result.js";

describe("Result combinators", () => {
  it("ok / err", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("bad")).toEqual({ ok: false, error: "bad" });
  });
  it("isOk / isErr", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err(1))).toBe(true);
  });
  it("map only applies on ok", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err("x"), (n: number) => n * 3)).toEqual(err("x"));
  });
  it("flatMap chains Results", () => {
    expect(flatMap(ok(2), (n) => ok(n + 1))).toEqual(ok(3));
    expect(flatMap(ok(2), (_n) => err("nope"))).toEqual(err("nope"));
    expect(flatMap(err("x"), (n: number) => ok(n))).toEqual(err("x"));
  });
  it("all concatenates errors", () => {
    const r = all([ok(1), err(["a"]), ok(2), err(["b", "c"])]);
    expect(r).toEqual(err(["a", "b", "c"]));
  });
  it("all returns values when all ok", () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
  });
});
