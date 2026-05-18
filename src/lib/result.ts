/**
 * Minimal Result<T, E> discriminated union.
 *
 * Used by pure runners so callers must handle errors explicitly,
 * rather than relying on throws that bubble through layers.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
