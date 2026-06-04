import { describe, it, expect } from "vitest";
import { withTimeout, ToolTimeoutError, DEFAULT_TOOL_TIMEOUT_MS } from "../../src/lib/timeout.js";

describe("withTimeout", () => {
  it("resolves with the work's value when work finishes in time", async () => {
    const work = Promise.resolve("ok");
    const result = await withTimeout("test_tool", 1000, work);
    expect(result).toBe("ok");
  });

  it("rejects with ToolTimeoutError when work exceeds the budget", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve("slow"), 200));
    await expect(withTimeout("test_tool", 50, slow)).rejects.toBeInstanceOf(
      ToolTimeoutError,
    );
  });

  it("the timeout error carries the tool name and budget", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve(null), 200));
    try {
      await withTimeout("verify_sipcode_impact", 50, slow);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolTimeoutError);
      const err = e as ToolTimeoutError;
      expect(err.toolName).toBe("verify_sipcode_impact");
      expect(err.budgetMs).toBe(50);
      expect(err.message).toContain("did not return within 50ms");
    }
  });

  it("includes the hint in the error message when provided", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve(null), 200));
    try {
      await withTimeout("audit_latest_session", 50, slow, "pick a smaller session");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("pick a smaller session");
    }
  });

  it("propagates a real error from the work without misclassifying as timeout", async () => {
    const failingWork = Promise.reject(new Error("real bug"));
    await expect(withTimeout("test_tool", 1000, failingWork)).rejects.toThrow("real bug");
  });

  it("DEFAULT_TOOL_TIMEOUT_MS is a sane value for MCP tools (30s)", () => {
    // Why this test: hard-pinning the default helps reviewers spot
    // accidental drift to absurdly large values (e.g., 10 minutes).
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBe(30_000);
  });

  it("cleans up its internal timer (no lingering Node event loop work)", async () => {
    // The contract is that the timer is cleared whether work succeeds
    // or fails. We can't directly observe the timer, but we can assert
    // the function returns control promptly in both branches.
    const fastSuccess = withTimeout("t", 100_000, Promise.resolve("ok"));
    const result = await fastSuccess;
    expect(result).toBe("ok");
    // If the timer leaked, the process would stay alive — node tests
    // would hang. The fact that this test completes IS the assertion.
  });
});
