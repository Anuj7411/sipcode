/**
 * Zod schemas for Claude Code's .jsonl transcript format.
 *
 * Real transcripts contain MANY shapes. We only validate the fields we
 * actually consume; everything else is allowed through as unknown.
 */
import { z } from "zod";

export const UsageSchema = z
  .object({
    input_tokens: z.number().nonnegative().optional(),
    output_tokens: z.number().nonnegative().optional(),
    cache_read_input_tokens: z.number().nonnegative().optional(),
    cache_creation_input_tokens: z.number().nonnegative().optional(),
  })
  .passthrough();

export const ToolUseContentSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string().optional(),
    name: z.string(),
    input: z.unknown().optional(),
  })
  .passthrough();

export const TextContentSchema = z
  .object({ type: z.literal("text"), text: z.string() })
  .passthrough();

export const ThinkingContentSchema = z
  .object({ type: z.literal("thinking") })
  .passthrough();

export const ToolResultContentSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().optional(),
    content: z.unknown().optional(),
  })
  .passthrough();

export const AssistantContentSchema = z.union([
  ToolUseContentSchema,
  TextContentSchema,
  ThinkingContentSchema,
  z.object({ type: z.string() }).passthrough(),
]);

/** Assistant entry — carries the usage block we cost from. */
export const AssistantEntrySchema = z
  .object({
    type: z.literal("assistant"),
    uuid: z.string().optional(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
    message: z
      .object({
        model: z.string().optional(),
        role: z.literal("assistant").optional(),
        content: z.array(AssistantContentSchema).optional(),
        usage: UsageSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** User entry — may carry a string prompt or an array containing tool_results. */
export const UserEntrySchema = z
  .object({
    type: z.literal("user"),
    uuid: z.string().optional(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
    message: z
      .object({
        role: z.literal("user").optional(),
        content: z.union([z.string(), z.array(z.unknown())]).optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Attachment / queue-operation / system entry — we tolerate but don't analyze. */
export const OtherEntrySchema = z
  .object({
    type: z.string(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();

export const TranscriptEntrySchema = z.union([
  AssistantEntrySchema,
  UserEntrySchema,
  OtherEntrySchema,
]);

export type AssistantEntry = z.infer<typeof AssistantEntrySchema>;
export type UserEntry = z.infer<typeof UserEntrySchema>;
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;
export type Usage = z.infer<typeof UsageSchema>;
