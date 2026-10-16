/**
 * The Codex plugin (plugins/sipcode) and its marketplace entry
 * (.agents/plugins/marketplace.json): structure per the official docs
 * (developers.openai.com/codex/plugins/build, /plugins/deploy/submission),
 * public-directory eligibility (skills only: no hooks, MCP servers or apps),
 * listing limits, and every `sipcode` command a skill tells Codex to run
 * exists in the CLI with the flags and values used.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLUGIN = path.join(ROOT, "plugins", "sipcode");
const SKILLS = ["sipcode-limits", "sipcode-regress", "sipcode-spend", "sipcode-why"];

const json = (p: string) => JSON.parse(readFileSync(p, "utf-8")) as Record<string, any>;
const manifest = json(path.join(PLUGIN, "plugin.json"));
const overlay = json(path.join(PLUGIN, ".codex-plugin", "plugin.json"));
const marketplace = json(path.join(ROOT, ".agents", "plugins", "marketplace.json"));
const pkg = json(path.join(ROOT, "package.json"));
const iface = manifest.extensions["com.openai"].interface as Record<string, any>;

/** All files under a folder, relative, with forward slashes. */
function filesUnder(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p, base) : [path.relative(base, p).replace(/\\/g, "/")];
  });
}

function frontmatter(text: string): { fields: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!] = kv[2]!;
  }
  return { fields, body: m[2]! };
}

const skillText = (name: string) => readFileSync(path.join(PLUGIN, "skills", name, "SKILL.md"), "utf-8");

/** Every `sipcode ...` command in a skill: inline code spans and lines of fenced blocks. */
function commands(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`(sipcode [^`]+)`/g)) out.add(m[1]!.trim());
  for (const block of text.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/g)) {
    for (const line of block[1]!.split(/\r?\n/)) if (line.trim().startsWith("sipcode ")) out.add(line.trim());
  }
  return [...out];
}

/**
 * `sipcode <args> --help` from the TypeScript source (no build needed), or
 * from the built `dist/cli.js` (what npm ships and what the skills run).
 */
type Entry = "src" | "dist";
const DIST_CLI = path.join(ROOT, "dist", "cli.js");
const helpCache = new Map<string, string>();
function help(sub?: string, entry: Entry = "src"): string {
  const key = `${entry}:${sub ?? ""}`;
  if (!helpCache.has(key)) {
    const launch = entry === "src" ? ["--import", "tsx", path.join(ROOT, "src", "cli.ts")] : [DIST_CLI];
    const r = spawnSync(process.execPath, [...launch, ...(sub ? [sub] : []), "--help"], {
      cwd: ROOT,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (r.status !== 0) throw new Error(`sipcode ${sub ?? ""} --help (${entry}) failed: ${r.stderr}`);
    helpCache.set(key, r.stdout);
  }
  return helpCache.get(key)!;
}

/** PNG width and height from the IHDR chunk. */
function pngSize(p: string): [number, number] {
  const b = readFileSync(p);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe("Codex plugin: manifest", () => {
  it("root plugin.json is the portable manifest: schema, kebab-case name, version = package version", () => {
    expect(manifest.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    expect(manifest.name).toBe("sipcode");
    expect(manifest.name).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.description.length).toBeLessThanOrEqual(4000);
    expect(manifest.author.name.length).toBeLessThanOrEqual(120);
    expect(manifest.author.url).toMatch(/^https:\/\//);
    expect(manifest.homepage).toMatch(/^https:\/\//);
  });

  it("only the fields the 1.0.0 schema allows (it has additionalProperties: false; no `skills` at the root)", () => {
    const allowed = ["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"];
    for (const k of Object.keys(manifest)) expect(allowed, k).toContain(k);
    expect(Object.keys(manifest.extensions)).toEqual(["com.openai"]);
  });

  it("directory listing fields within the submission limits", () => {
    expect(iface.displayName).toBe("Sipcode");
    expect(iface.displayName.length).toBeLessThanOrEqual(30);
    expect(iface.shortDescription.length).toBeLessThanOrEqual(30);
    expect(iface.longDescription.length).toBeLessThanOrEqual(4000);
    expect(iface.developerName.length).toBeLessThanOrEqual(80);
    expect(iface.category).toBe("Developer Tools");
    expect(iface.capabilities).toEqual(["Read"]);
    expect(iface.defaultPrompt.length).toBeLessThanOrEqual(3);
    for (const p of iface.defaultPrompt) expect(p.length).toBeLessThanOrEqual(128);
    expect(new Set(iface.defaultPrompt).size).toBe(iface.defaultPrompt.length);
    // All four listing URLs, on the publisher's own site (built from docs/site/src/pages).
    expect(iface.websiteURL).toBe("https://anuj7411.github.io/sipcode/");
    expect(iface.supportURL).toBe("https://anuj7411.github.io/sipcode/support/");
    expect(iface.privacyPolicyURL).toBe("https://anuj7411.github.io/sipcode/privacy/");
    expect(iface.termsOfServiceURL).toBe("https://anuj7411.github.io/sipcode/terms/");
    for (const page of ["support", "privacy", "terms"]) {
      expect(existsSync(path.join(ROOT, "docs", "site", "src", "pages", `${page}.astro`)), page).toBe(true);
    }
    for (const u of [iface.websiteURL, iface.supportURL, iface.privacyPolicyURL, iface.termsOfServiceURL]) {
      expect(u).toMatch(/^https:\/\//);
      expect(u.length).toBeLessThanOrEqual(1024);
    }
    expect(iface.brandColor).toMatch(/^#[0-9A-F]{6}$/);
  });

  // developers.openai.com/plugins/deploy/desktop-only: a skills-only plugin that calls
  // local programs sets requires_local_executor (Desktop only badge in the directory).
  it("marked Desktop only: the skills run the local sipcode command", () => {
    expect(manifest.extensions["com.openai"].requires_local_executor).toBe(true);
    expect(overlay.requires_local_executor).toBe(true);
  });

  it("logo and composer icon: ./assets paths, square PNG of at least 48 px, under 5 MiB", () => {
    for (const rel of [iface.logo, iface.composerIcon]) {
      expect(rel).toMatch(/^\.\/assets\//);
      const p = path.join(PLUGIN, rel);
      expect(existsSync(p), rel).toBe(true);
      const [w, h] = pngSize(p);
      expect(w).toBe(h);
      expect(w).toBeGreaterThanOrEqual(48);
      expect(statSync(p).size).toBeLessThan(5 * 1024 * 1024);
    }
  });

  it("the .codex-plugin overlay (older Codex) matches the root manifest", () => {
    for (const k of ["name", "version", "description", "author", "homepage", "repository", "license", "keywords"]) {
      expect(overlay[k], k).toEqual(manifest[k]);
    }
    expect(overlay.skills).toBe("./skills/");
    expect(overlay.interface).toEqual(iface);
    // Same keys as the inline extension (interface plus top-level OpenAI settings), nothing else.
    const { interface: _i, ...openaiRest } = manifest.extensions["com.openai"];
    for (const [k, v] of Object.entries(openaiRest)) expect(overlay[k], k).toEqual(v);
    const overlayKeys = ["name", "version", "description", "author", "homepage", "repository", "license", "keywords", "skills", "interface", ...Object.keys(openaiRest)];
    expect(Object.keys(overlay).sort()).toEqual([...overlayKeys].sort());
    expect(readdirSync(path.join(PLUGIN, ".codex-plugin"))).toEqual(["plugin.json"]);
  });
});

describe("Codex plugin: eligible for the public directory", () => {
  it("skills only: no hooks, no MCP servers, no apps", () => {
    const files = filesUnder(PLUGIN).sort();
    expect(files).toEqual([
      ".codex-plugin/plugin.json",
      "README.md",
      "assets/logo.png",
      "plugin.json",
      ...SKILLS.map((s) => `skills/${s}/SKILL.md`),
    ]);
    const openai = manifest.extensions["com.openai"];
    for (const k of ["hooks", "apps", "mcpServers"]) {
      expect(openai[k], k).toBeUndefined();
      expect(overlay[k], k).toBeUndefined();
    }
  });
});

describe("Codex plugin: marketplace", () => {
  it("lists the plugin from ./plugins/sipcode with the required policy and category", () => {
    expect(marketplace.name).toBe("sipcode");
    expect(marketplace.interface.displayName).toBe("Sipcode");
    expect(marketplace.plugins).toEqual([
      {
        name: "sipcode",
        source: { source: "local", path: "./plugins/sipcode" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Developer Tools",
      },
    ]);
    expect(existsSync(path.join(ROOT, marketplace.plugins[0].source.path, "plugin.json"))).toBe(true);
  });
});

describe("Codex plugin: skills", () => {
  it("one folder per skill, each with a SKILL.md whose name matches", () => {
    expect(readdirSync(path.join(PLUGIN, "skills")).sort()).toEqual(SKILLS);
    for (const s of SKILLS) {
      const { fields } = frontmatter(skillText(s));
      expect(fields.name, s).toBe(s);
      expect(fields.description!.length, s).toBeGreaterThan(80);
      expect(fields.description!.length, s).toBeLessThanOrEqual(1024);
    }
  });

  it("every skill: published CLI only, install hint, no npx, sandbox escalation, no reading logs, no invented numbers", () => {
    for (const s of SKILLS) {
      const t = skillText(s);
      expect(t, s).toContain("Run `npm i -g sipcode` once in a terminal, then ask again.");
      expect(t, s).toContain("Do not try `npx`");
      expect(t, s).toContain("request permission to run the same command again with read access");
      expect(t, s).toContain("Never open, read, search or summarise the log files yourself");
      expect(t, s).toMatch(/never invent/i);
      expect(t, s).not.toMatch(/\bnpx sipcode\b/);
    }
  });

  // Codex once answered with raw JSON values ("$3.2481702571428572", "88.99999999999999%",
  // "2026-10-14T06:25:29.384Z"). Skills that read JSON must round the way the terminal does.
  it("JSON skills present numbers the way the terminal does: cents, whole percents, separators, no ISO times", () => {
    for (const s of ["sipcode-spend", "sipcode-why"]) {
      const t = skillText(s);
      expect(t, s).not.toContain("Quote numbers exactly");
      expect(t, s).toContain("Dollars to the cent: `$3.25`");
      expect(t, s).toContain('"under $0.01"');
      expect(t, s).toContain("Percents as whole numbers: `89%`");
      expect(t, s).toContain("Below 1%, one decimal (`0.4%`)");
      expect(t, s).toContain("Tokens with thousands separators: `107,733`");
      expect(t, s).toContain("Never show an ISO string");
      expect(t, s).toContain("Never change a number beyond this rounding");
    }
  });

  it("limits: runs the terminal output (local times, rounded), never --json", () => {
    const t = skillText("sipcode-limits");
    expect(t).not.toContain("Quote numbers exactly");
    expect(t).not.toMatch(/sipcode limits[^`\n]*--json/);
    expect(t).toContain("in the user's local time zone");
    expect(t).toContain("Never show an ISO string");
    expect(t).toContain("Never change a number beyond this rounding");
  });

  // Codex once said "Weekly limit is 92% used ... reset-since, so its listed reset is stale".
  // The skill repeats the terminal's two reset-since wordings (limits/format-terminal.ts) in
  // plain words and never gives the old percent as current.
  it("limits: a window that reset is described like the terminal does, never with the old percent", () => {
    const t = skillText("sipcode-limits");
    expect(t).toContain('"no readings since it reset (');
    expect(t).toContain('"reset since your last Codex request (at ');
    expect(t).toMatch(/never give a percent for that limit/i);
    expect(t).not.toMatch(/\bstale\b/i);
    expect(t).not.toContain("reset-since");
    // usedBy is a "what used it" list for the current period, in points of the limit.
    expect(t).toContain("what used this limit in the current period");
  });

  it("why: topExpensive is the largest requests, and their tokens are never a tool call's cost", () => {
    const t = skillText("sipcode-why");
    expect(t).toContain("`topExpensive` (the largest requests and the tool call each one made)");
    expect(t).toContain("never say a tool call used or cost those tokens");
  });

  it("why: the non-output tokens are the context sent with each request, never exploration", () => {
    const t = skillText("sipcode-why");
    expect(t).toContain("`punchline.nonOutputTokens` are the context sent with each request");
    expect(t).toContain("never call them exploration, re-reads or idle context");
    // why's output ratio leaves cache reads out: it is not outputTokens / totalTokens.
    expect(t).toContain("`punchline.outputRatioPct` is output as a share of the tokens not read from cache");
  });

  it("Claude Code why skill: output ratio over the tokens not read from cache, no stale typical range", () => {
    const t = readFileSync(path.join(ROOT, "skills", "why", "SKILL.md"), "utf-8");
    expect(t).toContain("as a share of the tokens not read from cache");
    expect(t).not.toContain("0.3% to 2% is typical");
    expect(t).not.toMatch(/[\u2013\u2014]/);
  });

  it("regress: its terminal output is already display-ready and is quoted as printed", () => {
    expect(skillText("sipcode-regress")).toContain("Quote numbers exactly as printed");
  });

  it("regress: a long first run gets a long timeout, and empty output is never reported as a result", () => {
    // Codex's script runner killed `regress --bug-report` after about 10 s with no output (a cold run over
    // large Claude Code logs takes far longer).
    const t = skillText("sipcode-regress");
    expect(t).toContain("Give the command a timeout of at least 3 minutes.");
    expect(t).toContain("empty output is never a result");
  });

  it("regress: defaults to the Codex logs; reads Claude Code logs only when the user asks about Claude Code", () => {
    // A cold run over every Claude Code log took 49 s (5.4 GB) and Codex's runner stopped it at about 10 s;
    // the Codex logs alone take about 1 s.
    const t = skillText("sipcode-regress");
    const fenced = [...t.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]!.trim());
    expect(fenced[0]).toBe("sipcode regress --bug-report --agent codex");
    expect(t).toContain("If the user asks about Codex or does not name a tool, run the Codex check");
    expect(t).toContain("Run the Claude Code check only when the user explicitly asks about Claude Code");
    expect(t).toContain("`sipcode regress --bug-report --agent claude-code`");
    // Both tools: no --agent.
    expect(t).toContain("`sipcode regress --bug-report` (no `--agent`)");
    expect(t).toContain("the first run can take a minute or more");
    // The plain all-logs command is never the default.
    expect(t).not.toMatch(/Run this once:\s*```bash\r?\n\s*sipcode regress --bug-report\r?\n/);
  });

  it("every skill: Sipcode's unread-logs warning is said first", () => {
    for (const s of SKILLS) {
      expect(skillText(s), s).toContain('If Sipcode prints a line starting "warning:" that log files could not be read, say it first in your answer');
    }
  });

  it("copy rules: no em or en dashes, no 'stops hallucinations', 'nerfed' only in a prohibition", () => {
    const texts = [...SKILLS.map(skillText), JSON.stringify(manifest), JSON.stringify(overlay), JSON.stringify(marketplace)];
    for (const t of texts) {
      expect(t).not.toMatch(/[\u2013\u2014]/);
      expect(t.toLowerCase()).not.toContain("hallucination");
      for (const line of t.split("\n")) if (/nerfed/i.test(line)) expect(line).toMatch(/never|do not/i);
    }
  });

  it("limit cuts are always 'possible' with the other-devices caveat; regress findings outside the catalog are signals, not proof", () => {
    expect(skillText("sipcode-limits")).toContain('say "a possible limit cut"');
    expect(skillText("sipcode-limits")).toContain("Codex use on other devices or in the cloud raises the percent without local tokens");
    expect(skillText("sipcode-regress")).toContain("is a signal worth reporting, not proof of a bug");
    expect(skillText("sipcode-regress")).toContain("this is not a clean result. Never say \"no regressions\".");
    // One tool compared and the other not: "no regressions" must not cover the tool that was not compared.
    expect(skillText("sipcode-regress")).toContain('"Not enough data to compare Codex versions yet"');
    expect(skillText("sipcode-regress")).toContain('"Not enough data to compare Claude Code versions yet"');
  });
});

describe("Codex plugin: one request per answer, no pre-checks", () => {
  // Every extra command is an extra model request that re-sends the whole chat context.
  it("no skill runs a separate version check before the real command", () => {
    for (const s of SKILLS) expect(commands(skillText(s)), s).not.toContain("sipcode --version");
  });
  it("every skill still handles a missing or outdated sipcode from the real command's error", () => {
    for (const s of SKILLS) {
      const t = skillText(s);
      expect(t, s).toContain("npm i -g sipcode");
      expect(t, s).toContain("npm i -g sipcode@latest");
      expect(t, s).toContain("Do not check the Sipcode version first");
    }
  });
});

describe("Codex plugin: every command a skill runs exists in the CLI", () => {
  const all = SKILLS.flatMap((s) => commands(skillText(s)).map((c) => [s, c] as const));

  it("the skills name the commands the design calls for", () => {
    const cmds = all.map(([, c]) => c);
    for (const c of [
      "sipcode today --agent codex --json",
      "sipcode forecast --agent codex --json",
      "sipcode stats --agent codex --since 7d --json",
      "sipcode limits",
      "sipcode limits --since all",
      "sipcode why --agent codex --json",
      "sipcode why --agent codex --list",
      "sipcode why --agent codex --session <id> --json",
      "sipcode regress --bug-report",
      "sipcode regress --bug-report --agent codex",
      "sipcode regress --bug-report --agent claude-code",
    ]) {
      expect(cmds).toContain(c);
    }
  });

  function checkAll(entry: Entry): void {
    const top = help(undefined, entry);
    for (const [skill, cmd] of all) {
      const words = cmd.split(/\s+/).slice(1);
      if (words[0]!.startsWith("--")) {
        expect(top, `${skill}: ${cmd}`).toContain(words[0]!);
        continue;
      }
      const sub = words[0]!;
      expect(top, `${skill}: ${cmd}`).toMatch(new RegExp(`^\\s+${sub}\\b`, "m"));
      const subHelp = help(sub, entry);
      for (let i = 1; i < words.length; i++) {
        const w = words[i]!;
        if (!w.startsWith("--")) continue;
        expect(subHelp, `${skill}: ${cmd}`).toMatch(new RegExp(`(^|\\s|,)${w}(\\s|,|$)`, "m"));
        const value = words[i + 1];
        if (w === "--agent") expect(["codex", "claude-code"], `${skill}: ${cmd}`).toContain(value);
        if (w === "--since") expect(value, `${skill}: ${cmd}`).toMatch(/^(\d+d|all|\d{4}-\d{2}-\d{2})$/);
        if (w === "--session") expect(value).toBe("<id>");
      }
    }
  }

  it(
    "each subcommand and flag is in `sipcode --help` / `sipcode <command> --help`, with valid values",
    () => checkAll("src"),
    120_000,
  );

  // The built CLI (dist/cli.js) is what npm ships; CI builds before `npm test`.
  // Skipped only in a fresh checkout that has never been built.
  it.skipIf(!existsSync(DIST_CLI))(
    "the same commands and flags exist in the built dist/cli.js",
    () => checkAll("dist"),
    120_000,
  );
});

describe("Codex plugin: not shipped in the npm package", () => {
  it("package.json `files` does not include plugins/ or .agents/", () => {
    for (const f of pkg.files as string[]) {
      expect(f.startsWith("plugins")).toBe(false);
      expect(f.startsWith(".agents")).toBe(false);
    }
  });
});
