/**
 * `sipcode manifest` — Smart Project Manifest generator.
 * Implementation deferred to v0.1.0-alpha.2.
 *
 * Constraints (see docs/PROJECT-SPEC.md §6.1):
 *   - Zero LLM calls. tree-sitter + git only.
 *   - <2000 tokens for a 500-file project (S006 enforces).
 *   - Idempotent on unchanged trees.
 */
export interface ManifestOptions {
  budget?: boolean;
  delta?: boolean;
}

export async function runManifest(_opts: ManifestOptions): Promise<void> {
  console.log("sipcode manifest — not yet implemented (planned for v0.1.0-alpha.2).");
}
