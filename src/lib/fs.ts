/**
 * Filesystem seam — the ONLY place in src/ that imports node:fs.
 *
 * Everything else takes a `FileSystem` instance so InMemoryFs can replace
 * the real disk in tests.
 */
import * as nodeFs from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface DirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

export interface FileStat {
  readonly mtimeMs: number;
  readonly size: number;
}

export interface FileSystem {
  exists(p: string): Promise<boolean>;
  readFile(p: string): Promise<string>;
  readDir(p: string): Promise<DirEntry[]>;
  stat(p: string): Promise<FileStat>;
}

export class RealFileSystem implements FileSystem {
  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p, nodeFs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
  async readFile(p: string): Promise<string> {
    return fs.readFile(p, "utf-8");
  }
  async readDir(p: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(p, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    }));
  }
  async stat(p: string): Promise<FileStat> {
    const s = await fs.stat(p);
    return { mtimeMs: s.mtimeMs, size: s.size };
  }
}

interface InMemoryFile {
  readonly kind: "file";
  readonly content: string;
  readonly mtimeMs: number;
}
interface InMemoryDir {
  readonly kind: "dir";
}
type InMemoryNode = InMemoryFile | InMemoryDir;

export class InMemoryFs implements FileSystem {
  private nodes = new Map<string, InMemoryNode>();

  private norm(p: string): string {
    // Normalize separators and trailing slashes; keep posix-style for tests.
    return path.normalize(p).replace(/\\/g, "/").replace(/\/+$/g, "");
  }

  writeFile(p: string, content: string, mtimeMs = 0): void {
    const norm = this.norm(p);
    // Ensure parent dirs exist.
    const parts = norm.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (dir && !this.nodes.has(dir)) {
        this.nodes.set(dir, { kind: "dir" });
      }
    }
    this.nodes.set(norm, { kind: "file", content, mtimeMs });
  }

  mkdir(p: string): void {
    const norm = this.norm(p);
    const parts = norm.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (dir && !this.nodes.has(dir)) {
        this.nodes.set(dir, { kind: "dir" });
      }
    }
  }

  async exists(p: string): Promise<boolean> {
    return this.nodes.has(this.norm(p));
  }
  async readFile(p: string): Promise<string> {
    const n = this.nodes.get(this.norm(p));
    if (!n || n.kind !== "file") {
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    }
    return n.content;
  }
  async readDir(p: string): Promise<DirEntry[]> {
    const norm = this.norm(p);
    const n = this.nodes.get(norm);
    if (!n || n.kind !== "dir") {
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    }
    const prefix = norm === "" ? "" : norm + "/";
    const seen = new Map<string, DirEntry>();
    for (const [key, node] of this.nodes) {
      if (!key.startsWith(prefix) || key === norm) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (!name || seen.has(name)) continue;
      const childKey = prefix + name;
      const child = this.nodes.get(childKey);
      if (!child) continue;
      // Only include direct children.
      if (rest.includes("/") && child.kind === "file") continue;
      seen.set(name, {
        name,
        isDirectory: child.kind === "dir",
        isFile: child.kind === "file",
      });
    }
    // For nested files that imply intermediate dirs, also include them.
    for (const [key] of this.nodes) {
      if (!key.startsWith(prefix) || key === norm) continue;
      const rest = key.slice(prefix.length);
      const name = rest.split("/")[0];
      if (!name || seen.has(name)) continue;
      if (rest.includes("/")) {
        seen.set(name, { name, isDirectory: true, isFile: false });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
  async stat(p: string): Promise<FileStat> {
    const n = this.nodes.get(this.norm(p));
    if (!n) {
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
    }
    if (n.kind === "file") {
      return { mtimeMs: n.mtimeMs, size: n.content.length };
    }
    return { mtimeMs: 0, size: 0 };
  }
}
