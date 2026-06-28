import { describe, it, expect, vi } from "vitest";
import {
  shouldShowStarNudge,
  starNudgeMarkerPath,
} from "../../src/lib/starNudge.js";

describe("shouldShowStarNudge", () => {
  it("returns true the first time and writes the marker", async () => {
    const writeMarker = vi.fn(async () => {});
    const io = { hasMarker: vi.fn(async () => false), writeMarker };
    const r = await shouldShowStarNudge(io, "/home/u");
    expect(r).toBe(true);
    expect(writeMarker).toHaveBeenCalledWith(
      starNudgeMarkerPath("/home/u"),
      expect.any(String),
    );
  });

  it("returns false when the marker already exists (never repeats)", async () => {
    const writeMarker = vi.fn(async () => {});
    const io = { hasMarker: vi.fn(async () => true), writeMarker };
    const r = await shouldShowStarNudge(io, "/home/u");
    expect(r).toBe(false);
    expect(writeMarker).not.toHaveBeenCalled();
  });

  it("still returns true once if the marker write fails (best-effort, no crash)", async () => {
    const io = {
      hasMarker: vi.fn(async () => false),
      writeMarker: vi.fn(async () => {
        throw new Error("EPERM");
      }),
    };
    await expect(shouldShowStarNudge(io, "/home/u")).resolves.toBe(true);
  });

  it("puts the marker under ~/.sipcode", () => {
    expect(starNudgeMarkerPath("/home/u").replace(/\\/g, "/")).toBe(
      "/home/u/.sipcode/.star-nudge",
    );
  });
});
