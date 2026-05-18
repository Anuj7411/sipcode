/**
 * Branded types — see docs/AUDIT-FRAMEWORK.md "Branded types".
 *
 * Constructors validate at boundaries and throw SipcodeValidationError on
 * bad inputs. `unbrand(v)` is the escape hatch for raw access.
 */
import path from "node:path";
import { SipcodeValidationError } from "./errors.js";

type Brand<T, B> = T & { readonly __brand: B };

export type SessionId = Brand<string, "SessionId">;
export type AbsoluteFilePath = Brand<string, "AbsoluteFilePath">;
export type RelativeFilePath = Brand<string, "RelativeFilePath">;
export type TokenCount = Brand<number, "TokenCount">;
export type USDCents = Brand<number, "USDCents">;
export type CheckId = Brand<string, "CheckId">;
export type ModelId = Brand<string, "ModelId">;
export type ManifestVersion = Brand<string, "ManifestVersion">;

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

export const SessionId = (s: string): SessionId => {
  if (typeof s !== "string" || s.length === 0 || !SESSION_ID_RE.test(s)) {
    throw new SipcodeValidationError([
      {
        code: "E003",
        message: `not a valid session id: ${JSON.stringify(s)}`,
      },
    ]);
  }
  return s as SessionId;
};

export const AbsoluteFilePath = (s: string): AbsoluteFilePath => {
  if (typeof s !== "string" || s.length === 0 || !path.isAbsolute(s)) {
    throw new SipcodeValidationError([
      {
        code: "E003",
        message: `expected an absolute path, got ${JSON.stringify(s)}`,
      },
    ]);
  }
  return s as AbsoluteFilePath;
};

export const RelativeFilePath = (s: string): RelativeFilePath => {
  if (typeof s !== "string") {
    throw new SipcodeValidationError([
      { code: "E003", message: `expected a string path, got ${typeof s}` },
    ]);
  }
  return s as RelativeFilePath;
};

export const TokenCount = (n: number): TokenCount => {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new SipcodeValidationError([
      {
        code: "E003",
        message: `token count must be a non-negative finite number, got ${n}`,
      },
    ]);
  }
  return n as TokenCount;
};

export const USDCents = (n: number): USDCents => {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new SipcodeValidationError([
      { code: "E003", message: `usd cents must be a finite number, got ${n}` },
    ]);
  }
  return n as USDCents;
};

export const CheckId = (s: string): CheckId => {
  if (!/^[SMRE]\d{3}$/.test(s)) {
    throw new SipcodeValidationError([
      { code: "E003", message: `not a valid check id: ${JSON.stringify(s)}` },
    ]);
  }
  return s as CheckId;
};

export const ModelId = (s: string): ModelId => {
  if (typeof s !== "string" || s.length === 0) {
    throw new SipcodeValidationError([
      { code: "E003", message: `model id must be a non-empty string` },
    ]);
  }
  return s as ModelId;
};

export const ManifestVersion = (s: string): ManifestVersion =>
  s as ManifestVersion;

/** Raw access escape hatch (no-op at runtime). */
export const unbrand = <T>(v: unknown): T => v as T;
