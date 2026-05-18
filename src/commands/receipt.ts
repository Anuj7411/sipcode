/**
 * `sipcode receipt` — shareable savings receipt.
 * Implementation deferred to v0.1.0-alpha.3.
 *
 * Output formats (see docs/PROJECT-SPEC.md §6.3):
 *   - Terminal table (always)
 *   - HTML standalone file (default)
 *   - PNG OG-image (--png / --share)
 */
export interface ReceiptOptions {
  png?: boolean;
  html?: boolean;
}

export async function runReceipt(
  _sessionId: string | undefined,
  _opts: ReceiptOptions,
): Promise<void> {
  console.log("sipcode receipt — not yet implemented (planned for v0.1.0-alpha.3).");
}
