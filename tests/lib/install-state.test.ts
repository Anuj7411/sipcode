import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  emptyInstallState,
  readInstallState,
  writeInstallState,
  pickMarker,
} from "../../src/lib/install-state.js";

describe("install-state", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), "sipcode-install-state-"));
  });
  afterEach(() => {
    if (workdir) rmSync(workdir, { recursive: true, force: true });
  });

  it("returns null for an unwritten cwd", async () => {
    const got = await readInstallState(workdir);
    expect(got).toBeNull();
  });

  it("round-trips a write through a read", async () => {
    await writeInstallState(workdir, {
      rulesInstalledAt: "2026-05-21T00:00:00.000Z",
      rulesMode: "default",
    });
    const got = await readInstallState(workdir);
    expect(got).not.toBeNull();
    expect(got?.rulesInstalledAt).toBe("2026-05-21T00:00:00.000Z");
    expect(got?.rulesMode).toBe("default");
    expect(got?.schemaVersion).toBe("sipcode-install-state/1");
  });

  it("merges patches into existing state", async () => {
    await writeInstallState(workdir, { rulesInstalledAt: "2026-05-21T00:00:00.000Z", rulesMode: "default" });
    await writeInstallState(workdir, { hygieneInstalledAt: "2026-05-22T00:00:00.000Z" });
    const got = await readInstallState(workdir);
    expect(got?.rulesInstalledAt).toBe("2026-05-21T00:00:00.000Z");
    expect(got?.hygieneInstalledAt).toBe("2026-05-22T00:00:00.000Z");
    expect(got?.rulesMode).toBe("default");
  });

  it("returns null for a malformed install-state file", async () => {
    // Force-write garbage at the expected path.
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(path.join(workdir, ".sipcode"), { recursive: true });
    await writeFile(path.join(workdir, ".sipcode", "install-state.json"), "{not json", "utf-8");
    const got = await readInstallState(workdir);
    expect(got).toBeNull();
  });

  it("pickMarker prefers rules over hygiene", () => {
    const marker = pickMarker({
      schemaVersion: "sipcode-install-state/1",
      rulesInstalledAt: "2026-05-21T00:00:00.000Z",
      hygieneInstalledAt: "2026-05-22T00:00:00.000Z",
    });
    expect(marker?.source).toBe("install-state.json (rules)");
    expect(marker?.iso).toBe("2026-05-21T00:00:00.000Z");
  });

  it("pickMarker falls back to hygiene when rules is absent", () => {
    const marker = pickMarker({
      schemaVersion: "sipcode-install-state/1",
      hygieneInstalledAt: "2026-05-22T00:00:00.000Z",
    });
    expect(marker?.source).toBe("install-state.json (hygiene)");
  });

  it("pickMarker returns null when neither timestamp is present", () => {
    expect(pickMarker(emptyInstallState())).toBeNull();
    expect(pickMarker(null)).toBeNull();
  });
});
