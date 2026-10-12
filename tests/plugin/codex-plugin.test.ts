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
    for (const u of [iface.websiteURL, iface.privacyPolicyURL]) {
      expect(u).toMatch(/^https:\/\//);
      expect(u.length).toBeLessThanOrEqual(1024);
    }
    expect(iface.brandColor).toMatch(/^#[0-9A-F]{6}$/);
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
    expect(readdirSync(path.join(PLUGIN, ".codex-plugin"))).toEqual(["plugin.json"]);
  });
});

describe("Codex plugin: eligible for the public directory", () => {
  it("skills only: no hooks, no MCP servers, no apps", () => {
    const files = filesUnder(PLUGIN).sort();
    expect(files).toEqual([
      ".codex-plugin/plugin.json",
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

  it("every skill: published CLI only, install hint, no npx, sandbox escalation, no reading logs, exact numbers", () => {
    for (const s of SKILLS) {
      const t = skillText(s);
      expect(t, s).toContain("Run `npm i -g sipcode` once in a terminal, then ask again.");
      expect(t, s).toContain("Do not try `npx`");
      expect(t, s).toContain("request permission to run the same command again with read access");
      expect(t, s).toContain("Never open, read, search or summarise the log files yourself");
      expect(t, s).toContain("Quote numbers exactly as");
      expect(t, s).not.toMatch(/\bnpx sipcode\b/);
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

describe("Codex plugin: every command a skill runs exists in the CLI", () => {
  const all = SKILLS.flatMap((s) => commands(skillText(s)).map((c) => [s, c] as const));

  it("the skills name the commands the design calls for", () => {
    const cmds = all.map(([, c]) => c);
    for (const c of [
      "sipcode --version",
      "sipcode today --agent codex --json",
      "sipcode forecast --agent codex --json",
      "sipcode stats --agent codex --since 7d --json",
      "sipcode limits --json",
      "sipcode limits --json --since all",
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
