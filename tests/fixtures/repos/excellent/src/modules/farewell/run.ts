/**
 * farewell — say goodbye.
 */
export function runFarewell(args: ReadonlyArray<string>): number {
  const name = args[0] ?? "world";
  process.stdout.write(`goodbye, ${name}\n`);
  return 0;
}
