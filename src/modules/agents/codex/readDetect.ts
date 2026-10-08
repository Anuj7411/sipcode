/**
 * Codex has no dedicated read tool: it reads files through shell commands.
 * Recognise ONLY unambiguous single-file reads, so duplicate-read detection
 * never guesses. Partial reads carry a range so reading lines 1-40 and later
 * 41-80 of the same file is not reported as a duplicate. Pure.
 *
 * Deliberately conservative (all return undefined): pipes, chaining, redirects,
 * subshells, globs, unresolved variables, multiple files, unknown flags,
 * `cat -n`, `nl`, unterminated quotes, and flags with a missing or non-numeric
 * value.
 */
export interface ReadTarget {
  readonly path: string;
  readonly range?: string;
}

const UNSAFE = /[|;&<>`]|\$\(/; // pipes, chaining, redirects, subshells
const GLOB = /[*?]/;
const VARIABLE = /\$/; // $HOME, $env:X: the real path is unknowable from the text
const COUNT = /^\d+$/;

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

function single(path: string | undefined, range?: string): ReadTarget | undefined {
  if (!path || GLOB.test(path) || VARIABLE.test(path)) return undefined;
  return range ? { path, range } : { path };
}

function isCount(v: string | undefined): v is string {
  return v !== undefined && COUNT.test(v);
}

export function detectShellRead(command: string): ReadTarget | undefined {
  const cmd = command.trim();
  if (!cmd || UNSAFE.test(cmd)) return undefined;
  const t = tokenize(cmd);
  if (!t || t.length < 2) return undefined;
  const [bin, ...args] = t;
  const name = bin!.toLowerCase();

  if ((name === "cat" || name === "type") && args.length === 1 && !args[0]!.startsWith("-")) {
    return single(args[0]);
  }

  if (name === "get-content" || name === "gc") {
    let path: string | undefined;
    let range: string | undefined;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      const lower = a.toLowerCase();
      if (lower === "-raw") continue;
      if (lower === "-path" || lower === "-literalpath") {
        if (path) return undefined;
        path = args[++i];
        if (path === undefined) return undefined;
        continue;
      }
      if (lower === "-encoding") {
        if (args[++i] === undefined) return undefined;
        continue;
      }
      if (lower === "-totalcount" || lower === "-head" || lower === "-first") {
        const n = args[++i];
        if (range || !isCount(n)) return undefined;
        range = `head:${n}`;
        continue;
      }
      if (lower === "-tail" || lower === "-last") {
        const n = args[++i];
        if (range || !isCount(n)) return undefined;
        range = `tail:${n}`;
        continue;
      }
      if (a.startsWith("-")) return undefined;
      if (path) return undefined;
      path = a;
    }
    return single(path, range);
  }

  if (name === "head" || name === "tail") {
    let n: string | undefined;
    let path: string | undefined;
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === "-n") {
        const v = args[++i];
        if (n !== undefined || !isCount(v)) return undefined;
        n = v;
        continue;
      }
      if (/^-\d+$/.test(a)) {
        if (n !== undefined) return undefined;
        n = a.slice(1);
        continue;
      }
      if (a.startsWith("-")) return undefined;
      if (path) return undefined;
      path = a;
    }
    return single(path, `${name}:${n ?? "10"}`);
  }

  // `sed -n 'A,Bp' file` and the single-line form `sed -n 'Np' file` (range "N-N").
  if (name === "sed" && args[0] === "-n" && args.length === 3) {
    const m = /^(\d+)(?:,(\d+))?p$/.exec(args[1]!);
    if (!m) return undefined;
    return single(args[2], `${m[1]}-${m[2] ?? m[1]}`);
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
    if (i >= 0 && rest[i + 1] !== undefined) return rest[i + 1]!;
  }
  return argv.join(" ");
}
