/**
 * cli — entry point for the `excellent` demo project.
 *
 * Parses argv and dispatches to the router. Kept thin on purpose.
 */
import { route } from "./router.js";

export function main(argv: ReadonlyArray<string>): number {
  return route(argv);
}
