import { describe, expect, it } from "vitest";
import { shortSessionId } from "../../src/lib/session-id.js";

describe("shortSessionId", () => {
  it("Claude Code ids keep 8 characters (unchanged), even when they look time-ordered", () => {
    expect(shortSessionId("3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f")).toBe("3f2a9c1e");
    expect(shortSessionId("3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f", "claude-code")).toBe("3f2a9c1e");
    expect(shortSessionId("0199a1b2-c3d4-7a11-8000-000000000001", "claude-code")).toBe("0199a1b2");
  });

  it("a Codex UUIDv7 id keeps its full timestamp and 12 random bits, a prefix of the id", () => {
    const id = "0199a1b2-c3d4-7a11-8000-000000000001";
    expect(shortSessionId(id, "codex")).toBe("0199a1b2-c3d4-7a11");
    expect(id.startsWith(shortSessionId(id, "codex"))).toBe(true);
    // Same millisecond, different random bits: still apart.
    expect(shortSessionId("0199a1b2-c3d4-7b22-8000-000000000002", "codex")).not.toBe(shortSessionId(id, "codex"));
  });

  it("other Codex ids (not UUIDv7, or short test ids) keep 8 characters", () => {
    expect(shortSessionId("3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f", "codex")).toBe("3f2a9c1e");
    expect(shortSessionId("cx1", "codex")).toBe("cx1");
  });
});
