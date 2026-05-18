/**
 * Minimal Result<T, E> discriminated union.
 *
 * Pure runners return Results so callers must handle errors explicitly.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(
  r: Result<T, E>,
): r is { readonly ok: true; readonly value: T } => r.ok;

export const isErr = <T, E>(
  r: Result<T, E>,
): r is { readonly ok: false; readonly error: E } => !r.ok;

export const map = <T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> =>
  r.ok ? ok(fn(r.value)) : r;

export const flatMap = <T, U, E>(
  r: Result<T, E>,
  fn: (v: T) => Result<U, E>,
): Result<U, E> => (r.ok ? fn(r.value) : r);

/**
 * Collect Results whose error type is an array. Concatenates all errors.
 */
export const all = <T, E>(
  results: ReadonlyArray<Result<T, E[]>>,
): Result<T[], E[]> => {
  const values: T[] = [];
  const errors: E[] = [];
  for (const r of results) {
    if (r.ok) values.push(r.value);
    else errors.push(...r.error);
  }
  return errors.length > 0 ? err(errors) : ok(values);
};
