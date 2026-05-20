# BT001 — expected result

- all 12 files import or reference newFunctionName (and not oldFunctionName).
- the exported declaration in src/utils.ts is renamed.
- tests still pass (the test file references newFunctionName).
