# BT016 — expected result

- src/types.ts no longer produces a circular-inference diagnostic from tsc.
- src/lib/wrap.ts narrows correctly.
- tsc --noEmit passes.
