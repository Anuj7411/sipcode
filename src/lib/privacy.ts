/**
 * Brand-voice assertion: this code path is part of Sipcode's privacy
 * surface. Adding network access here is a breaking change requiring
 * an explicit opt-in flag and an entry in PRIVACY.md.
 *
 * Importing this constant is a documentation contract — the privacy
 * guard test (`tests/privacy/no-network.test.ts`) asserts that any
 * file under `src/commands/` that touches user data also imports
 * `ASSERT_NO_NETWORK` and does NOT import a network module.
 *
 * The constant has no runtime effect. Its presence is the signal.
 */
export const ASSERT_NO_NETWORK = "sipcode-no-network/v1";
