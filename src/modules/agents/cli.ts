/**
 * CLI-level helpers for the --agent option.
 *
 * Commands import `resolveAgentFromOpts` to normalize the raw flag, run
 * detection, surface the banner/ambiguity message, and return the picked
 * Agent. Keeps the boilerplate out of each command.
 */
import { MESSAGES } from "../../lib/messages.js";
import { detectAgent, type AgentDetectResult } from "./detect.js";
import { ALL_AGENT_IDS, type AgentId, type AgentSelector } from "./types.js";
import type { Agent } from "./types.js";
import { getAgentById } from "./registry.js";
import type { FileSystem } from "../../lib/fs.js";
import type { ProcessEnv } from "../../lib/process.js";

export type ParseAgentResult =
  | { ok: true; selector: AgentSelector }
  | { ok: false; message: string };

/** Parse the raw --agent flag value. Defaults to "auto" when undefined. */
export function parseAgentFlag(raw: string | undefined): ParseAgentResult {
  if (raw === undefined || raw === "auto" || raw === "") {
    return { ok: true, selector: "auto" };
  }
  if ((ALL_AGENT_IDS as readonly string[]).includes(raw)) {
    return { ok: true, selector: raw as AgentId };
  }
  return { ok: false, message: MESSAGES.agentUnknown(raw) };
}

export interface ResolveAgentInputs {
  agent: string | undefined;
  fs: FileSystem;
  env: ProcessEnv;
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** When true, suppress the "detected agent: ..." banner. */
  quiet?: boolean;
}

export type ResolveAgentResult =
  | { ok: true; agent: Agent; detect: AgentDetectResult }
  | { ok: false; exitCode: 1 };

/**
 * One-call helper for commands: parse flag → detect → emit banner →
 * return the picked Agent. Returns `{ok:false}` on unknown agent id.
 */
export async function resolveAgentFromOpts(
  inputs: ResolveAgentInputs,
): Promise<ResolveAgentResult> {
  const parsed = parseAgentFlag(inputs.agent);
  if (!parsed.ok) {
    inputs.stderr(parsed.message);
    return { ok: false, exitCode: 1 };
  }
  const detect = await detectAgent({
    selector: parsed.selector,
    fs: inputs.fs,
    env: inputs.env,
    cwd: inputs.cwd,
  });
  if (!detect.explicit && !inputs.quiet) {
    inputs.stdout(MESSAGES.agentDetectedAuto(detect.agent));
    if (detect.ambiguous) {
      inputs.stdout(MESSAGES.agentAmbiguous());
    }
  }
  return { ok: true, agent: getAgentById(detect.agent), detect };
}
