import { describe, expect, it } from "vitest";
import {
  AbsoluteFilePath,
  CheckId,
  ModelId,
  SessionId,
  TokenCount,
  USDCents,
} from "../../src/lib/types.js";
import { SipcodeValidationError } from "../../src/lib/errors.js";

describe("branded type validators", () => {
  it("SessionId accepts valid ids and rejects others", () => {
    expect(SessionId("abc-123_DEF")).toBe("abc-123_DEF");
    expect(() => SessionId("")).toThrow(SipcodeValidationError);
    expect(() => SessionId("has space")).toThrow();
    expect(() => SessionId("has/slash")).toThrow();
  });

  it("AbsoluteFilePath requires absolute paths", () => {
    expect(AbsoluteFilePath("/home/u/foo")).toBe("/home/u/foo");
    expect(() => AbsoluteFilePath("relative/path")).toThrow();
    expect(() => AbsoluteFilePath("")).toThrow();
  });

  it("TokenCount rejects negative or non-finite", () => {
    expect(TokenCount(0)).toBe(0);
    expect(TokenCount(123)).toBe(123);
    expect(() => TokenCount(-1)).toThrow();
    expect(() => TokenCount(Number.NaN)).toThrow();
    expect(() => TokenCount(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("USDCents allows finite numbers (negative allowed for refunds)", () => {
    expect(USDCents(100)).toBe(100);
    expect(USDCents(-50)).toBe(-50);
    expect(() => USDCents(Number.NaN)).toThrow();
  });

  it("CheckId only accepts S###, M###, R###, E### shapes", () => {
    expect(CheckId("S001")).toBe("S001");
    expect(CheckId("M012")).toBe("M012");
    expect(() => CheckId("X001")).toThrow();
    expect(() => CheckId("s001")).toThrow();
  });

  it("ModelId requires non-empty string", () => {
    expect(ModelId("claude-opus-4")).toBe("claude-opus-4");
    expect(() => ModelId("")).toThrow();
  });
});
