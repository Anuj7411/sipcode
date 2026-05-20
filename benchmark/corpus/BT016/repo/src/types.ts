// BUG: cycle — Result references wrap's return type which references Result.
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
