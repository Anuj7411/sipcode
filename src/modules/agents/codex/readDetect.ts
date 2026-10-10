/**
 * Codex has no dedicated read tool: it reads files through shell commands.
 * Recognise ONLY unambiguous single-file reads, so duplicate-read detection
 * never guesses. Partial reads carry a range so reading lines 1-40 and later
 * 41-80 of the same file is not reported as a duplicate. Pure.
 *
 * Ranges: `A-B` is an inclusive 1-based line span (head reads normalise to
 * `1-N`); `tail:N` stays symbolic because it needs the file length. No range
 * means the whole file.
 *
 * Deliberately conservative (all return undefined): pipes, chaining, redirects,
 * subshells, multi-line commands, globs, wildcards, unresolved variables,
 * `~` / `%VAR%` paths, comma-separated (multiple) paths, multiple files,
 * unknown flags, `cat -n`, `nl`, unterminated quotes, and flags with a missing,
 * non-numeric or out-of-range value. The only pipelines accepted are two exact
 * PowerShell idioms:
 *   Get-Content F | Select-Object -First N | -Last N | -Skip S -First N
 *   $i=0; Get-Content F | ForEach-Object { $i++; '{0,4}: {1}' -f $i, $_ }
 */
export interface ReadTarget {
  readonly path: string;
  readonly range?: string;
}

const UNSAFE = /[|;&<>`]|\$\(/; // pipes, chaining, redirects, subshells
const GLOB = /[*?]/;
const BRACES = /[{}]/;
const BRACKETS = /[[\]]/; // wildcard in PowerShell -Path, literal with -LiteralPath
const VARIABLE = /\$/; // $HOME, $env:X: the real path is unknowable from the text
const PCT_VAR = /%[^%\s]+%/; // cmd.exe %VAR%
const NEWLINE = /[\r\n]/;

// The numbered whole-file idiom, matched as one exact pattern. The format string
// may not contain anything that could chain, pipe, redirect or expand.
const FMT = "'[^'$|;&<>`\\r\\n]*'\\s*-f\\s*\\$i\\s*,\\s*\\$_";
const NUMBERED = new RegExp(
  "^\\$i\\s*=\\s*\\d+\\s*;\\s*(?:get-content|gc)\\s+([^|;{}$]+?)\\s*\\|\\s*foreach-object\\s*\\{\\s*" +
    `(?:\\$i\\+\\+\\s*;\\s*${FMT}|${FMT}\\s*;\\s*\\$i\\+\\+)` +
    "\\s*\\}$",
  "i",
);
const SELECT = /^(?:get-content|gc)\s+(.+?)\s*\|\s*select-object\s+([^|]+)$/i;

function tokenize(cmd: string): string[] | undefined {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
      continue;
    }
    cur += ch;
  }
  if (quote) return undefined;
  if (cur || has) out.push(cur);
  return out;
}

function single(path: string | undefined, range?: string, literal = false): ReadTarget | undefined {
  if (!path || GLOB.test(path) || VARIABLE.test(path) || BRACES.test(path)) return undefined;
  if (path.includes(",")) return undefined; // PowerShell reads every comma-separated file
  if (path.startsWith("~") || PCT_VAR.test(path)) return undefined;
  if (!literal && BRACKETS.test(path)) return undefined;
  return range ? { path, range } : { path };
}

/** Integer >= min, written as plain digits, or undefined. */
function num(v: string | undefined, min: number): number | undefined {
  if (v === undefined || !/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min ? n : undefined;
}

interface GetContentArgs {
  readonly path: string;
  readonly range?: string;
  readonly raw: boolean;
  readonly literal: boolean;
}

function parseGetContent(args: ReadonlyArray<string>): GetContentArgs | undefined {
  let path: string | undefined;
  let range: string | undefined;
  let raw = false;
  let literal = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const lower = a.toLowerCase();
    if (lower === "-raw") {
      raw = true;
      continue;
    }
    if (lower === "-path" || lower === "-literalpath") {
      if (path !== undefined) return undefined;
      path = args[++i];
      if (path === undefined) return undefined;
      literal = lower === "-literalpath";
      continue;
    }
    if (lower === "-encoding") {
      if (args[++i] === undefined) return undefined;
      continue;
    }
    if (lower === "-totalcount" || lower === "-head" || lower === "-first") {
      const n = num(args[++i], 1);
      if (range || n === undefined) return undefined;
      range = `1-${n}`;
      continue;
    }
    if (lower === "-tail" || lower === "-last") {
      const n = num(args[++i], 1);
      if (range || n === undefined) return undefined;
      range = `tail:${n}`;
      continue;
    }
    if (a.startsWith("-")) return undefined;
    if (path !== undefined) return undefined;
    path = a;
  }
  if (path === undefined) return undefined;
  return range ? { path, range, raw, literal } : { path, raw, literal };
}

/** `Get-Content` arguments (everything after the cmdlet name) for a whole-file read. */
function wholeFileGetContent(argText: string, allowRaw: boolean): ReadTarget | undefined {
  if (UNSAFE.test(argText)) return undefined;
  const t = tokenize(argText);
  if (!t) return undefined;
  const g = parseGetContent(t);
  if (!g || g.range || (g.raw && !allowRaw)) return undefined;
  return single(g.path, undefined, g.literal);
}

/** `Select-Object` arguments: -First N, -Last N, or -Skip S -First N. */
function parseSelect(argText: string): string | undefined {
  if (UNSAFE.test(argText)) return undefined;
  const t = tokenize(argText);
  if (!t || t.length === 0) return undefined;
  let first: number | undefined;
  let last: number | undefined;
  let skip: number | undefined;
  for (let i = 0; i < t.length; i++) {
    const flag = t[i]!.toLowerCase();
    if (flag === "-first") {
      const n = num(t[++i], 1);
      if (first !== undefined || n === undefined) return undefined;
      first = n;
    } else if (flag === "-last") {
      const n = num(t[++i], 1);
      if (last !== undefined || n === undefined) return undefined;
      last = n;
    } else if (flag === "-skip") {
      const n = num(t[++i], 0);
      if (skip !== undefined || n === undefined) return undefined;
      skip = n;
    } else {
      return undefined;
    }
  }
  if (last !== undefined) return first === undefined && skip === undefined ? `tail:${last}` : undefined;
  if (first === undefined) return undefined; // -Skip alone has no known end
  const start = (skip ?? 0) + 1;
  return `${start}-${start - 1 + first}`;
}

export function detectShellRead(command: string): ReadTarget | undefined {
  const cmd = command.trim();
  if (!cmd || NEWLINE.test(cmd)) return undefined;

  const numbered = NUMBERED.exec(cmd);
  if (numbered) return wholeFileGetContent(numbered[1]!, true);

  const sel = SELECT.exec(cmd);
  if (sel) {
    // -Raw emits one string, so Select-Object would not window by line.
    const file = wholeFileGetContent(sel[1]!, false);
    const range = parseSelect(sel[2]!);
    return file && range ? { path: file.path, range } : undefined;
  }

  if (UNSAFE.test(cmd)) return undefined;
  const t = tokenize(cmd);
  if (!t || t.length < 2) return undefined;
  const [bin, ...args] = t;
  const name = bin!.toLowerCase();

  if ((name === "cat" || name === "type") && args.length === 1 && !args[0]!.startsWith("-")) {
    // bash `type X` is a command lookup; only treat it as a read when X looks like a path.
    if (name === "type" && !/[./\\]/.test(args[0]!)) return undefined;
    return single(args[0]);
  }

  if (name === "get-content" || name === "gc") {
    const g = parseGetContent(args);
    return g ? single(g.path, g.range, g.literal) : undefined;
  }

  if (name === "head" || name === "tail") {
    let n: number | undefined;
    let path: string | undefined;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === "-n") {
        const v = num(args[++i], 1);
        if (n !== undefined || v === undefined) return undefined;
        n = v;
        continue;
      }
      if (/^-\d+$/.test(a)) {
        const v = num(a.slice(1), 1);
        if (n !== undefined || v === undefined) return undefined;
        n = v;
        continue;
      }
      if (a.startsWith("-")) return undefined;
      if (path !== undefined) return undefined;
      path = a;
    }
    const count = n ?? 10;
    return single(path, name === "head" ? `1-${count}` : `tail:${count}`);
  }

  // `sed -n 'A,Bp' file` and the single-line form `sed -n 'Np' file` (range "N-N").
  if (name === "sed" && args[0] === "-n" && args.length === 3) {
    const m = /^(\d+)(?:,(\d+))?p$/.exec(args[1]!);
    if (!m) return undefined;
    const start = num(m[1], 1);
    const end = num(m[2] ?? m[1], 1);
    if (start === undefined || end === undefined || end < start) return undefined;
    return single(args[2], `${start}-${end}`);
  }

  return undefined;
}

/** Legacy `shell` / `local_shell` calls pass argv; unwrap `bash -lc "..."` and PowerShell `-Command "..."`. */
export function unwrapShellArgv(argv: ReadonlyArray<string>): string {
  const [bin, ...rest] = argv;
  const b = (bin ?? "").toLowerCase().replace(/^.*[\\/]/, "").replace(/\.exe$/, "");
  if ((b === "bash" || b === "sh" || b === "zsh") && (rest[0] === "-lc" || rest[0] === "-c") && rest.length >= 2) {
    return rest[1]!;
  }
  if (b === "powershell" || b === "pwsh") {
    const i = rest.findIndex((r) => r.toLowerCase() === "-command" || r.toLowerCase() === "-c");
    if (i >= 0 && rest[i + 1] !== undefined) return rest.slice(i + 1).join(" ");
  }
  return argv.join(" ");
}
