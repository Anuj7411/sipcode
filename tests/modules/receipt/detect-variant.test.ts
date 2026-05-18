import { describe, expect, it } from "vitest";
import { detectVariant } from "../../../src/modules/receipt/detect-variant.js";
import { InMemoryFs } from "../../../src/lib/fs.js";

describe("detectVariant", () => {
  it("returns post-install when .sipcode/manifest.md exists", async () => {
    const fs = new InMemoryFs();
    fs.writeFile("/proj/.sipcode/manifest.md", "# manifest");
    const v = await detectVariant(fs, {
      projectRoot: "/proj",
      sessionStartedAt: "2026-05-10T00:00:00Z",
    });
    expect(v).toBe("post-install");
  });

  it("returns pre-install when no manifest", async () => {
    const fs = new InMemoryFs();
    fs.mkdir("/proj");
    const v = await detectVariant(fs, {
      projectRoot: "/proj",
      sessionStartedAt: "2026-05-10T00:00:00Z",
    });
    expect(v).toBe("pre-install");
  });

  it("defaults to post-install when project root is unknown", async () => {
    const fs = new InMemoryFs();
    const v = await detectVariant(fs, {
      projectRoot: undefined,
      sessionStartedAt: undefined,
    });
    expect(v).toBe("post-install");
  });
});
