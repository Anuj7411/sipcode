/**
 * Claude Code `Read` tool parameter injector.
 *
 * Read accepts a `limit` parameter. When absent on a text file, inject
 * `limit: 2000` to cap unbounded reads of large files. Images and PDFs
 * are passed through — Claude Code handles their sizing natively (images
 * are visual; PDFs use page-based reads).
 */
import type { RewriterFn } from "../types.js";

const READ_LIMIT = 2000;

const SKIP_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".pdf",
  ".ipynb",
];

export const rewriteNativeRead: RewriterFn = (input) => {
  const filePath = input.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  if (input.limit !== undefined) return null;

  const lower = filePath.toLowerCase();
  if (SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext))) return null;

  return {
    updatedInput: { ...input, limit: READ_LIMIT },
    savedTokensEstimate: 3000,
    rewriterName: "native-read",
  };
};
