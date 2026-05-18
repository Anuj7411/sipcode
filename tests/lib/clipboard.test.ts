import { describe, expect, it, vi } from "vitest";
import {
  FakeClipboard,
  RealClipboard,
  type ClipboardStrategy,
} from "../../src/lib/clipboard.js";
import { FakeProcessEnv } from "../../src/lib/process.js";

// Capture execFile calls so we can assert the spawned argv per platform
// without touching the real binaries on the host machine.
const execFileMock = vi.fn();
let execFileShouldFail = false;
let execFileFailMessage = "boom";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    execFile: (
      cmd: string,
      args: readonly string[],
      _opts: unknown,
      cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
    ) => {
      execFileMock(cmd, args);
      if (execFileShouldFail) {
        cb(new Error(execFileFailMessage), { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
    },
  };
});

describe("FakeClipboard", () => {
  it("records copy attempts and returns ok by default", async () => {
    const c = new FakeClipboard();
    const r = await c.copyPng("/tmp/x.png");
    expect(r.ok).toBe(true);
    expect(c.copies).toEqual(["/tmp/x.png"]);
  });

  it("returns a graceful failure when forced", async () => {
    const c = new FakeClipboard({ fail: true, failReason: "nope" });
    const r = await c.copyPng("/tmp/y.png");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("nope");
    expect(c.copies).toEqual(["/tmp/y.png"]);
  });

  it("reports the configured strategy", () => {
    const c = new FakeClipboard({ strategy: "macos" });
    expect(c.detect()).toBe("macos");
  });
});

describe("RealClipboard.detect", () => {
  const cases: ReadonlyArray<{
    name: string;
    env: ConstructorParameters<typeof FakeProcessEnv>[0];
    expect: ClipboardStrategy;
  }> = [
    {
      name: "windows",
      env: { platform: "win32" },
      expect: "windows",
    },
    {
      name: "macos",
      env: { platform: "darwin" },
      expect: "macos",
    },
    {
      name: "linux + WAYLAND_DISPLAY → wayland",
      env: { platform: "linux", vars: { WAYLAND_DISPLAY: "wayland-0" } },
      expect: "linux-wayland",
    },
    {
      name: "linux + DISPLAY → x11",
      env: { platform: "linux", vars: { DISPLAY: ":0" } },
      expect: "linux-x11",
    },
    {
      name: "linux + no display → x11 (best-effort)",
      env: { platform: "linux" },
      expect: "linux-x11",
    },
    {
      name: "freebsd → unsupported",
      env: { platform: "freebsd" as NodeJS.Platform },
      expect: "unsupported",
    },
  ];

  for (const c of cases) {
    it(`detects ${c.name}`, () => {
      const env = new FakeProcessEnv(c.env);
      const cb = new RealClipboard(env);
      expect(cb.detect()).toBe(c.expect);
    });
  }
});

describe("RealClipboard.copyPng — argv per platform", () => {
  it("windows: spawns powershell with Set-Clipboard pipeline", async () => {
    execFileMock.mockClear();
    const cb = new RealClipboard(new FakeProcessEnv({ platform: "win32" }));
    const r = await cb.copyPng("C:/tmp/x.png");
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe("windows");
    expect(execFileMock).toHaveBeenCalledOnce();
    const [bin, args] = execFileMock.mock.calls[0]!;
    expect(bin).toBe("powershell");
    expect(args).toContain("-NoProfile");
    // The Set-Clipboard PS command should reference the path we passed.
    const cmd = (args as string[]).join(" ");
    expect(cmd).toContain("C:/tmp/x.png");
    expect(cmd).toContain("Clipboard");
  });

  it("macos: spawns osascript with a PNGf AppleScript", async () => {
    execFileMock.mockClear();
    const cb = new RealClipboard(new FakeProcessEnv({ platform: "darwin" }));
    const r = await cb.copyPng("/tmp/x.png");
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe("macos");
    const [bin, args] = execFileMock.mock.calls[0]!;
    expect(bin).toBe("osascript");
    expect((args as string[])[0]).toBe("-e");
    expect((args as string[])[1]).toContain("PNGf");
    expect((args as string[])[1]).toContain("/tmp/x.png");
  });

  it("linux-x11: spawns xclip with image/png target", async () => {
    execFileMock.mockClear();
    const cb = new RealClipboard(
      new FakeProcessEnv({ platform: "linux", vars: { DISPLAY: ":0" } }),
    );
    const r = await cb.copyPng("/tmp/x.png");
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe("linux-x11");
    const [bin, args] = execFileMock.mock.calls[0]!;
    expect(bin).toBe("xclip");
    expect(args).toContain("clipboard");
    expect(args).toContain("image/png");
    expect(args).toContain("/tmp/x.png");
  });

  it("execFile error → returns ok=false with a friendly reason", async () => {
    execFileMock.mockClear();
    execFileShouldFail = true;
    execFileFailMessage = "xclip is sad";
    try {
      const cb = new RealClipboard(
        new FakeProcessEnv({ platform: "linux", vars: { DISPLAY: ":0" } }),
      );
      const r = await cb.copyPng("/tmp/some.png");
      expect(r.ok).toBe(false);
      expect(r.strategy).toBe("linux-x11");
      expect(r.reason).toContain("clipboard tool failed");
      expect(r.reason).toContain("xclip is sad");
    } finally {
      execFileShouldFail = false;
    }
  });

  it("truncates very long error messages", async () => {
    execFileMock.mockClear();
    execFileShouldFail = true;
    execFileFailMessage = "x".repeat(500);
    try {
      const cb = new RealClipboard(new FakeProcessEnv({ platform: "darwin" }));
      const r = await cb.copyPng("/tmp/x.png");
      expect(r.ok).toBe(false);
      expect(r.reason!.length).toBeLessThan(220);
      expect(r.reason).toMatch(/…$/);
    } finally {
      execFileShouldFail = false;
    }
  });

  it("freebsd → returns ok=false with a friendly reason", async () => {
    execFileMock.mockClear();
    const cb = new RealClipboard(
      new FakeProcessEnv({ platform: "freebsd" as NodeJS.Platform }),
    );
    const r = await cb.copyPng("/tmp/x.png");
    expect(r.ok).toBe(false);
    expect(r.strategy).toBe("unsupported");
    expect(r.reason).toContain("not supported");
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
