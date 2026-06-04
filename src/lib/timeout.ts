/**
 * Per-tool timeout protection for the MCP server.
 *
 * Why this exists: when an MCP tool handler hangs (slow filesystem
 * walk, an await that never resolves, a bug), Claude Desktop shows
 * "server is down" after its own client-side timeout (~4 minutes).
 * Users distrust that message.
 *
 * `withTimeout` wraps a tool handler in a Promise.race against a
 * timeout. When the handler exceeds the budget, we return a
 * structured error to Claude INSTEAD of letting the client time out
 * silently. The user sees a real diagnostic ("audit timed out on
 * 600+ sessions — try `since: <date>` to narrow the scan") and a
 * suggested fix, not a vague server-failure message.
 *
 * Guard contract: every tool handler in src/mcp/server.ts MUST be
 * wrapped. Asserted by tests/guards/mcp-tool-timeouts.test.ts.
 */

/** Default budget for an MCP tool to complete. Tunable per call. */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export class ToolTimeoutError extends Error {
  readonly kind = "tool-timeout" as const;
  constructor(
    readonly toolName: string,
    readonly budgetMs: number,
    readonly hint?: string,
  ) {
    super(
      `Tool ${toolName} did not return within ${budgetMs}ms.`
        + (hint ? ` Hint: ${hint}` : ""),
    );
    this.name = "ToolTimeoutError";
  }
}

/**
 * Race a promise against a timeout. Resolves with the promise's
 * value if it completes in time. Rejects with `ToolTimeoutError`
 * if not.
 *
 * The original work is NOT cancelled (Node has no general
 * cancellation primitive). It continues running but its result
 * is discarded. Callers should keep tool handlers idempotent and
 * side-effect-free where possible.
 *
 * @param toolName  for diagnostic clarity in the error message
 * @param budgetMs  how long to wait before giving up
 * @param work      the actual tool work
 * @param hint      optional diagnostic hint shown to the user on
 *                  timeout (e.g., "pass since: YYYY-MM-DD to narrow
 *                  the scan")
 */
export function withTimeout<T>(
  toolName: string,
  budgetMs: number,
  work: Promise<T>,
  hint?: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ToolTimeoutError(toolName, budgetMs, hint));
    }, budgetMs);
    // Don't keep the event loop alive solely for this timer.
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  });

  return Promise.race([work, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
