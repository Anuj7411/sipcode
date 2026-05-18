/**
 * Branded types — see docs/AUDIT-FRAMEWORK.md "Branded types".
 *
 * These prevent string-substitution bugs at compile time:
 *   const id: SessionId = "abc";          // ❌ Type error
 *   const id = "abc" as SessionId;        // ✅ explicit cast, audit-trail
 */
type Brand<T, B> = T & { readonly __brand: B };

export type SessionId = Brand<string, "SessionId">;
export type AbsoluteFilePath = Brand<string, "AbsoluteFilePath">;
export type RelativeFilePath = Brand<string, "RelativeFilePath">;
export type TokenCount = Brand<number, "TokenCount">;
export type USDCents = Brand<number, "USDCents">;
export type CheckId = Brand<string, "CheckId">; // S001, M001, R001, E001…
export type ModelId = Brand<string, "ModelId">;
export type ManifestVersion = Brand<string, "ManifestVersion">;

// Convenience constructors (no runtime cost; communicate intent).
export const SessionId = (s: string): SessionId => s as SessionId;
export const AbsoluteFilePath = (s: string): AbsoluteFilePath => s as AbsoluteFilePath;
export const RelativeFilePath = (s: string): RelativeFilePath => s as RelativeFilePath;
export const TokenCount = (n: number): TokenCount => n as TokenCount;
export const USDCents = (n: number): USDCents => n as USDCents;
export const CheckId = (s: string): CheckId => s as CheckId;
export const ModelId = (s: string): ModelId => s as ModelId;
