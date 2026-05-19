/**
 * router — maps CLI commands to feature modules.
 *
 * Pure: takes argv, returns an exit code.
 */
import { runGreet } from "./modules/greet/run.js";
import { runFarewell } from "./modules/farewell/run.js";

export function route(argv: ReadonlyArray<string>): number {
  const cmd = argv[0] ?? "greet";
  if (cmd === "greet") return runGreet(argv.slice(1));
  if (cmd === "farewell") return runFarewell(argv.slice(1));
  return 1;
}
