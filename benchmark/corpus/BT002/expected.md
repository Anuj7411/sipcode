# BT002 — expected result

- src/payment/process.ts handles `customer == null` without throwing.
- the existing test suite continues to pass; no behavior change for signed-in users.
