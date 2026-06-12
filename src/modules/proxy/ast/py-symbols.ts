import { createRequire } from "node:module";

/**
 * Extract top-level Python symbols via tree-sitter-python.
 *
 * Mirrors `ts-symbols.ts`. Returns the same `ExtractedSymbol[]` shape so the
 * orchestrator can treat both languages uniformly.
 *
 * Impure (depends on tree-sitter native binding). Loader is wrapped so an
 * environment without the binding falls through to "pass through full file."
 */
import type { ExtractedSymbol, SymbolKind } from "./ts-symbols.js";

interface ParserBundle {
  Parser: new () => {
    setLanguage(lang: unknown): void;
    parse(text: string): { rootNode: TSNode };
  };
  langPy: unknown;
}

interface TSNode {
  type: string;
  text: string;
  children: TSNode[];
  startPosition: { row: number };
  endPosition: { row: number };
  childForFieldName(name: string): TSNode | null;
}

let cached: ParserBundle | null | undefined;

function loadParser(): ParserBundle | null {
  if (cached !== undefined) return cached;
  try {
    const localRequire = createRequire(import.meta.url);
    const Parser = localRequire("tree-sitter") as ParserBundle["Parser"];
    const Py = localRequire("tree-sitter-python") as unknown;
    cached = { Parser, langPy: Py };
  } catch {
    cached = null;
  }
  return cached;
}

export function isPyFile(filePath: string): boolean {
  return /\.pyi?$/i.test(filePath);
}

export function extractPySymbols(
  _filePath: string,
  content: string,
): ExtractedSymbol[] {
  const bundle = loadParser();
  if (!bundle) return [];
  try {
    const parser = new bundle.Parser();
    parser.setLanguage(bundle.langPy);
    const tree = parser.parse(content);
    return collectSymbols(tree.rootNode);
  } catch {
    return [];
  }
}

function collectSymbols(root: TSNode): ExtractedSymbol[] {
  const out: ExtractedSymbol[] = [];
  for (const child of root.children) {
    pushSymbol(child, out);
  }
  return out;
}

function pushSymbol(node: TSNode, out: ExtractedSymbol[]): void {
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;

  switch (node.type) {
    case "function_definition":
    case "async_function_definition": {
      const name = nameOf(node);
      if (name) {
        out.push(buildSymbol(name, "function", startLine, endLine));
      }
      return;
    }
    case "decorated_definition": {
      // Walk the wrapped definition; treat as same kind, decoration adds lines.
      const inner = node.children.find(
        (c) =>
          c.type === "function_definition" ||
          c.type === "async_function_definition" ||
          c.type === "class_definition",
      );
      if (inner) {
        const name = nameOf(inner);
        if (name) {
          const kind: SymbolKind = inner.type === "class_definition" ? "class" : "function";
          out.push(buildSymbol(name, kind, startLine, endLine));
        }
      }
      return;
    }
    case "class_definition": {
      const name = nameOf(node);
      if (name) {
        out.push(buildSymbol(name, "class", startLine, endLine));
      }
      return;
    }
    case "expression_statement": {
      // Module-level assignment: NAME = ...
      const assign = node.children[0];
      if (assign && assign.type === "assignment") {
        const left = assign.children[0];
        if (left && left.type === "identifier" && left.text) {
          out.push(buildSymbol(left.text, "const", startLine, endLine));
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
  for (const c of node.children) {
    if (c.type === "identifier") return c.text;
  }
  return null;
}

function buildSymbol(
  name: string,
  kind: SymbolKind,
  startLine: number,
  endLine: number,
): ExtractedSymbol {
  return {
    name,
    kind,
    startLine,
    endLine,
    isTopLevel: true,
    // Python doesn't distinguish "exported" at parse time; treat all top-level
    // names as exported unless they start with underscore (PEP 8 convention).
    isExported: !name.startsWith("_"),
  };
}
