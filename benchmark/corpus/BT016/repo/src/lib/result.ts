import type { Result } from '../types.js';
export const ok = <T>(v: T): Result<T, never> => ({ ok: true, value: v });
export const err = <E>(e: E): Result<never, E> => ({ ok: false, error: e });
