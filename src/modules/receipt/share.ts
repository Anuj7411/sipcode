/**
 * Share-link builder — pure: ReceiptModel → ReceiptShareLinks.
 *
 * Currently generates a single pre-filled Twitter intent URL. Local-only —
 * no shortlink server, no telemetry. (S090 still binding.)
 */
import type { ReceiptModel, ReceiptShareLinks } from "./types.js";

const TWITTER_INTENT_BASE = "https://twitter.com/intent/tweet";

export function buildShareLinks(model: ReceiptModel): ReceiptShareLinks {
  const verb = model.variant === "post-install" ? "sipped" : "wasted";
  const tweetText =
    `${verb} ${model.hero.tokensDisplay} tokens this session with @sipcode_dev — ` +
    `that's ${model.hero.dollarDisplay} on the meter. ${model.footer.tagline}`;
  // URLSearchParams uses application/x-www-form-urlencoded (+ for spaces).
  // Twitter intent prefers %20 encoding; build manually with encodeURIComponent.
  const tweetIntentUrl = `${TWITTER_INTENT_BASE}?text=${encodeURIComponent(tweetText)}`;
  return { tweetIntentUrl, tweetText };
}
