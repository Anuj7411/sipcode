/**
 * Extract top-level symbols from a TypeScript/JavaScript file via tree-sitter.
 *
 * Impure: depends on tree-sitter native bindings. Loader is wrapped in
 * try/catch — if the binding fails to load (Bun, Alpine, broken install),
 * the orchestrator falls back to "pass through full file" so Claude Code
 * is never broken.
 *
 * Returns symbols ordered by appearance. Each has 1-indexed startLine and
 * endLine matching the `offset` semantics of Claude Code's Read tool.
 *
 * Lives outside `rewriters/` so the rewriter-purity guard doesn't apply.
 */

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "let"
  | "var"
  | "enum";

export interface ExtractedSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  /** 1-indexed line where the declaration starts. */
  readonly startLine: number;
  /** 1-indexed line where the declaration ends. */
  readonly endLine: number;
  /** True if this is at the top level of the file (vs nested). */
  readonly isTopLevel: true;
  /** True if exported (export keyword present). */
  readonly isExported: boolean;
}

interface ParserBundle {
  Parser: new () => {
    setLanguage(lang: unknown): void;
    parse(text: string): { rootNode: TSNode };
  };
  langTs: unknown;
  langTsx: unknown;
}

interface TSNode {
  type: string;
  text: string;
  children: TSNode[];
  startPosition: { row: number };
  endPosition: { row: number };
  childForFieldName(name: string): TSNode | null;
}

let cached: ParserBundle | null | undefined; // undefined = not tried, null = tried and failed

function loadParser(): ParserBundle | null {
  if (cached !== undefined) return cached;
  try {
    // require() inside this function so import-time failures don't crash
    // the entire proxy hook script when tree-sitter isn't loadable.
    const createRequire = require("node:module").createRequire;
    const localRequire = createRequire(__filename ?? import.meta.url);
    const Parser = localRequire("tree-sitter") as ParserBundle["Parser"];
    const TS = localRequire("tree-sitter-typescript") as {
      typescript: unknown;
      tsx: unknown;
    };
    cached = { Parser, langTs: TS.typescript, langTsx: TS.tsx };
  } catch {
    cached = null;
  }
  return cached;
}

/** Returns true iff the file extension is supported by this extractor. */
export function isTsLikeFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(filePath);
}

/** True iff this filePath is TSX/JSX (needs the tsx grammar). */
function isJsxLike(filePath: string): boolean {
  return /\.(tsx|jsx)$/i.test(filePath);
}

/**
 * Extract top-level symbols. Returns empty array on parser-load failure or
 * a parse error so the orchestrator falls through to "pass through full file."
 */
export function extractTsSymbols(
  filePath: string,
  content: string,
): ExtractedSymbol[] {
  const bundle = loadParser();
  if (!bundle) return [];
  try {
    const parser = new bundle.Parser();
    parser.setLanguage(isJsxLike(filePath) ? bundle.langTsx : bundle.langTs);
    const tree = parser.parse(content);
    return collectSymbols(tree.rootNode);
  } catch {
    return [];
  }
}

function collectSymbols(root: TSNode): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = [];
  for (const child of root.children) {
    pushSymbol(child, out, /*exported=*/ false);
  }
  return out;
}

function pushSymbol(
  node: TSNode,
  out: ExtractedSymbol[],
  exportedContext: boolean,
): void {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;

  switch (node.type) {
    case "export_statement": {
      // Walk into the wrapped declaration with exportedContext=true.
      for (const c of node.children) {
        if (c.type === "export" || c.type === "default") continue;
        pushSymbol(c, out, /*exported=*/ true);
      }
      return;
    }
    case "function_declaration": {
      const name = nameOf(node);
      if (name) {
        out.push({
          name,
          kind: "function",
          startLine,
          endLine,
          isTopLevel: true,
          isExported: exportedContext,
        });
      }
      return;
    }
    case "class_declaration": {
      const name = nameOf(node);
      if (name) {
        out.push({
          name,
          kind: "class",
          startLine,
          endLine,
          isTopLevel: true,
          isExported: exportedContext,
        });
      }
      return;
    }
    case "interface_declaration": {
      const name = nameOf(node);
      if (name) {
        out.push({
          name,
          kind: "interface",
          startLine,
          endLine,
          isTopLevel: true,
          isExported: exportedContext,
        });
      }
      return;
    }
    case "type_alias_declaration": {
      const name = nameOf(node);
      if (name) {
        out.push({
          name,
          kind: "type",
          startLine,
          endLine,
          isTopLevel: true,
          isExported: exportedContext,
        });
      }
      return;
    }
    case "enum_declaration": {
      const name = nameOf(node);
      if (name) {
        out.push({
          name,
          kind: "enum",
          startLine,
          endLine,
          isTopLevel: true,
          isExported: exportedContext,
        });
      }
      return;
    }
    case "lexical_declaration":
    case "variable_declaration": {
      // const|let|var x = ... ; possibly multiple declarators.
      const kindWord = firstChildText(node);
      const kind: SymbolKind =
        kindWord === "const" ? "const" : kindWord === "let" ? "let" : "var";
      for (const c of node.children) {
        if (c.type === "variable_declarator") {
          const name = nameOf(c);
          if (name) {
            out.push({
              name,
              kind,
              startLine,
              endLine,
              isTopLevel: true,
              isExported: exportedContext,
            });
          }
        }
      }
      return;
    }
    default:
      return;
  }
}

function nameOf(node: TSNode): string | null {
  const id = node.childForFieldName("name");
  if (id && id.text) return id.text;
  // Fallback: scan children for an identifier-like node.
  for (const c of node.children) {
    if (c.type === "identifier" || c.type === "type_identifier") {
      return c.text;
    }
  }
  return null;
}

function firstChildText(node: TSNode): string | null {
  return node.children[0]?.text ?? null;
}
