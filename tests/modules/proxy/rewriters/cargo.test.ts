import { describe, it, expect } from "vitest";
import { rewriteCargoBuild } from "../../../../src/modules/proxy/rewriters/cargo.js";

describe("rewriteCargoBuild", () => {
  it("adds --quiet to `cargo build`", () => {
    const r = rewriteCargoBuild({ command: "cargo build" });
    expect(r?.updatedInput.command).toBe("cargo build --quiet");
    expect(r?.rewriterName).toBe("cargo");
  });
  it("works for `cargo check` and `cargo test` too", () => {
    expect(rewriteCargoBuild({ command: "cargo check" })?.updatedInput.command).toBe("cargo check --quiet");
    expect(rewriteCargoBuild({ command: "cargo test" })?.updatedInput.command).toBe("cargo test --quiet");
  });
  it("does NOT rewrite when --quiet already set", () => {
    expect(rewriteCargoBuild({ command: "cargo build --quiet" })).toBeNull();
  });
  it("does NOT rewrite when -q is set", () => {
    expect(rewriteCargoBuild({ command: "cargo build -q" })).toBeNull();
  });
  it("does NOT rewrite when caller wants verbose", () => {
    expect(rewriteCargoBuild({ command: "cargo build -v" })).toBeNull();
    expect(rewriteCargoBuild({ command: "cargo build --verbose" })).toBeNull();
  });
  it("does NOT match `cargo` alone or `cargo run`", () => {
    expect(rewriteCargoBuild({ command: "cargo run" })).toBeNull();
    expect(rewriteCargoBuild({ command: "cargo" })).toBeNull();
  });
});
