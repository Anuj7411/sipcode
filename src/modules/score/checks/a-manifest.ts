/**
 * Category A — manifest & routing (20 pts).
 *
 * Does the repo tell an agent how to navigate itself? CLAUDE.md exists, isn't
 * a wall of text, a project manifest is around, and routing rules don't
 * conflict.
 */
import { approxTokenCount } from "../../../lib/tokenizer.js";
import { registerCheck } from "../registry.js";
import { checkId } from "../types.js";
import type { CodebaseSnapshot } from "../types.js";

registerCheck({
  id: checkId("SC001"),
  category: "A",
  label: "CLAUDE.md exists at repo root",
  maxPoints: 5,
  run: (snap) => {
    if (snap.claudeMd && snap.claudeMd.trim().length > 0) {
      return { passed: true };
    }
    return {
      passed: false,
      details: "no CLAUDE.md at repo root — agents can't find routing rules",
    };
  },
});

registerCheck({
  id: checkId("SC002"),
  category: "A",
  label: "CLAUDE.md under 4000 tokens",
  maxPoints: 4,
  run: (snap) => {
    if (!snap.claudeMd) return { passed: false, details: "no CLAUDE.md to size-check" };
    const tokens = approxTokenCount(snap.claudeMd);
    if (tokens <= 4000) return { passed: true };
    return {
      passed: false,
      details: `CLAUDE.md is ~${tokens} tokens (cap is 4000 — burns context budget every turn)`,
    };
  },
});

registerCheck({
  id: checkId("SC003"),
  category: "A",
  label: "project manifest present (.sipcode/manifest.md, AGENTS.md, or rich README)",
  maxPoints: 3,
  run: (snap) => {
    if (snap.sipcodeManifest && snap.sipcodeManifest.trim().length > 0) {
      return { passed: true };
    }
    if (snap.agentsMd && snap.agentsMd.trim().length > 0) {
      return { passed: true };
    }
    if (snap.readme && countOpeningSectionWords(snap.readme) >= 80) {
      return { passed: true };
    }
    return {
      passed: false,
      details:
        "no .sipcode/manifest.md, no AGENTS.md, and README's opening is too thin (need ~80 words)",
    };
  },
});

registerCheck({
  id: checkId("SC004"),
  category: "A",
  label: "CLAUDE.md mentions routing rules (skills or slash-commands)",
  maxPoints: 4,
  run: (snap) => {
    if (!snap.claudeMd) {
      return {
        passed: false,
        details: "no CLAUDE.md — can't declare which skill handles which task",
      };
    }
    // Look for slash-command references or skill words.
    const text = snap.claudeMd;
    if (/(^|\s)\/[a-z][a-z0-9_-]+/m.test(text)) return { passed: true };
    if (/\b(skill|skills|sub-?agent|sub-?agents|routing)\b/i.test(text)) {
      return { passed: true };
    }
    return {
      passed: false,
      details:
        "CLAUDE.md doesn't reference any /slash-commands, skills, or subagents — agents won't route work",
    };
  },
});

registerCheck({
  id: checkId("SC005"),
  category: "A",
  label: "no conflicting routing sources",
  maxPoints: 4,
  run: (snap) => {
    const hasClaude = !!snap.claudeMd && snap.claudeMd.trim().length > 0;
    const hasCursor = !!snap.cursorRules && snap.cursorRules.trim().length > 0;
    if (!hasClaude || !hasCursor) return { passed: true };
    // Both exist — flag if their contents look materially different.
    // Heuristic: if either contains content the other doesn't mention by even
    // a normalized substring of >= 40 chars, treat as a conflict signal. We
    // don't compute a real diff — coarse is fine here.
    const claudeNorm = normalize(snap.claudeMd!);
    const cursorNorm = normalize(snap.cursorRules!);
    if (claudeNorm.length < 50 && cursorNorm.length < 50) return { passed: true };
    if (
      claudeNorm.includes(cursorNorm) ||
      cursorNorm.includes(claudeNorm)
    ) {
      return { passed: true };
    }
    return {
      passed: false,
      details:
        "both CLAUDE.md and .cursorrules exist with different content — pick one source of truth (or symlink)",
    };
  },
});

function countOpeningSectionWords(md: string): number {
  const lines = md.split(/\r?\n/);
  // Take everything before the second markdown heading.
  let sawFirst = false;
  const buf: string[] = [];
  for (const ln of lines) {
    if (/^#{1,6}\s+/.test(ln)) {
      if (!sawFirst) {
        sawFirst = true;
        continue;
      }
      break;
    }
    if (sawFirst) buf.push(ln);
  }
  const text = buf.join(" ").replace(/[`*_>#]/g, " ");
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
