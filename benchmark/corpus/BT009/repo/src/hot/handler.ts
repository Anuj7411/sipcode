export function handle(key) {
  // expensive lookup with no caching.
  return slowLookup(key);
}
function slowLookup(_k) { return 1; }
