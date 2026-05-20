// PR-introduced feature.
export function feature(items) {
  // O(n^2) — flagged in review.
  const out = [];
  for (const a of items) for (const b of items) if (a.id === b.id) out.push(a);
  return out;
}
