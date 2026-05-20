import type { Result } from '../types.js';
export function wrap<T, E>(fn: () => T): Result<T, E> { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e as E }; } }
