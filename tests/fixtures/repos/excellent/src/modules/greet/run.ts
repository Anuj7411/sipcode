/**
 * greet — say hello.
 */
export function runGreet(args: ReadonlyArray<string>): number {
  const name = args[0] ?? "world";
  process.stdout.write(`hello, ${name}\n`);
  return 0;
}
