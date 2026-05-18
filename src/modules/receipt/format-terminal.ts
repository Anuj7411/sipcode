/**
 * Terminal summary for `sipcode receipt`.
 *
 * Pure. Always printed (tight summary) so the user sees what got saved even
 * if PNG render fails and they only get HTML.
 */
import chalk from "chalk";
import type { ReceiptModel } from "./types.js";

interface FormatOptions {
  readonly useColor: boolean;
}

export function formatTerminal(
  model: ReceiptModel,
  opts: FormatOptions = { useColor: true },
): string {
  const c = makeColors(opts.useColor);
  const lines: string[] = [];

  const hero =
    model.variant === "post-install"
      ? c.mint(`${model.hero.tokensDisplay} tokens sipped`)
      : c.red(`${model.hero.tokensDisplay} tokens wasted`);

  lines.push(`${c.bold("sipcode")} ${c.dim("·")} session ${c.cyan(model.header.sessionIdShort)} ${c.dim("·")} ${model.header.durationDisplay} ${c.dim("·")} ${model.header.dateDisplay}`);
  lines.push("");
  lines.push(`  ${hero}  ${c.dim(`(${model.hero.dollarDisplay})`)}`);
  lines.push("");
  if (model.leaks.length > 0) {
    lines.push(c.bold("  what we caught"));
    for (const leak of model.leaks) {
      lines.push(
        `    ${leak.rank}. ${leak.title.padEnd(34)} ${c.dim(leak.tokensDisplay.padStart(10))}`,
      );
    }
    lines.push("");
  }
  lines.push(c.dim(`  prices as of ${model.hero.pricingAsOf}`));
  lines.push("");

  return lines.join("\n");
}

function makeColors(useColor: boolean) {
  if (!useColor) {
    const id = (s: string) => s;
    return { bold: id, dim: id, cyan: id, mint: id, red: id };
  }
  return {
    bold: chalk.bold,
    dim: chalk.dim,
    cyan: chalk.cyan,
    // Approximate brand mint/red with hex.
    mint: (s: string) => chalk.hex("#3DDC97")(s),
    red: (s: string) => chalk.hex("#FF6B6B")(s),
  };
}
