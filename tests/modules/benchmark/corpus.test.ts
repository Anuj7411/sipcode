import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  defaultCorpusDir,
  loadCorpus,
  parseFlatYaml,
  pickQuickTasks,
} from "../../../src/modules/benchmark/corpus.js";

describe("parseFlatYaml", () => {
  it("parses key: value pairs", () => {
    const r = parseFlatYaml(`id: BT001\ntitle: "hello world"`);
    expect(r["id"]).toBe("BT001");
    expect(r["title"]).toBe("hello world");
  });

  it("ignores comments and blank lines", () => {
    const r = parseFlatYaml(`# a comment\n\nid: BT002\n`);
    expect(r["id"]).toBe("BT002");
  });

  it("strips inline single and double quotes from values", () => {
    const r = parseFlatYaml(`title: 'quoted value'\nnotes: "double"`);
    expect(r["title"]).toBe("quoted value");
    expect(r["notes"]).toBe("double");
  });
});

describe("loadCorpus", () => {
  it("discovers all 10 BT tasks from the locked corpus", () => {
    const r = loadCorpus(defaultCorpusDir());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = r.value.map((t) => t.id).sort();
    expect(ids).toEqual([
      "BT001",
      "BT002",
      "BT003",
      "BT004",
      "BT005",
      "BT006",
      "BT007",
      "BT008",
      "BT009",
      "BT010",
    ]);
  });

  it("returns absolute transcript paths that exist", () => {
    const r = loadCorpus(defaultCorpusDir());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const task of r.value) {
      expect(path.isAbsolute(task.baselineTranscriptPath)).toBe(true);
      expect(path.isAbsolute(task.optimizedTranscriptPath)).toBe(true);
    }
  });

  it("errors with E003 when the corpus dir doesn't exist", () => {
    const r = loadCorpus("/no/such/path/anywhere/4f2a");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error[0]?.code).toBe("E003");
  });
});

describe("pickQuickTasks", () => {
  it("returns the requested number of tasks", () => {
    const r = loadCorpus(defaultCorpusDir());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const quick = pickQuickTasks(r.value, 3);
    expect(quick.length).toBe(3);
  });

  it("returns all tasks when N >= corpus size", () => {
    const r = loadCorpus(defaultCorpusDir());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const quick = pickQuickTasks(r.value, 100);
    expect(quick.length).toBe(r.value.length);
  });
});
