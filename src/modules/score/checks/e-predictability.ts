/**
 * Category E — predictability (20 pts).
 *
 * Tooling consistency: one test framework, one package manager, build
 * scripts, .gitignore, lockfile.
 */
import { registerCheck } from "../registry.js";
import { checkId } from "../types.js";

registerCheck({
  id: checkId("SC040"),
  category: "E",
  label: "test framework consistent (one of: vitest, jest, pytest, go test)",
  maxPoints: 5,
  run: (snap) => {
    // If patterns module already settled on a single framework, we're good.
    if (snap.patterns.testFramework === "none") {
      return { passed: true }; // no tests = no inconsistency
    }
    // Inspect package.json devDependencies for competing frameworks.
    const pj = snap.packageJson;
    const present: string[] = [];
    if (pj && typeof pj === "object") {
      const deps = collectDeps(pj);
      if (deps.has("vitest")) present.push("vitest");
      if (deps.has("jest") || deps.has("@jest/core")) present.push("jest");
      if (deps.has("mocha")) present.push("mocha");
      if (deps.has("ava")) present.push("ava");
      if (deps.has("jasmine")) present.push("jasmine");
    }
    if (present.length >= 2) {
      return {
        passed: false,
        details: `multiple JS test frameworks declared: ${present.join(", ")}`,
      };
    }
    return { passed: true };
  },
});

registerCheck({
  id: checkId("SC041"),
  category: "E",
  label: "package manager consistent (single lockfile)",
  maxPoints: 4,
  run: (snap) => {
    const locks: string[] = [];
    for (const lf of [
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lockb",
      "bun.lock",
    ]) {
      if (snap.hasFile(lf)) locks.push(lf);
    }
    if (locks.length <= 1) return { passed: true };
    return {
      passed: false,
      details: `multiple JS lockfiles present: ${locks.join(", ")} — pick one package manager`,
    };
  },
});

registerCheck({
  id: checkId("SC042"),
  category: "E",
  label: "build/scripts entry declared (package.json scripts, pyproject, or go.mod)",
  maxPoints: 4,
  run: (snap) => {
    if (snap.packageJson && typeof snap.packageJson === "object") {
      const s = (snap.packageJson as { scripts?: unknown }).scripts;
      if (s && typeof s === "object" && Object.keys(s).length > 0) {
        return { passed: true };
      }
    }
    if (snap.pyprojectToml) {
      // Look for [project.scripts] or [tool.poetry.scripts] or [project.entry-points]
      if (/\[(project|tool\.poetry)\.(scripts|entry-points)/.test(snap.pyprojectToml)) {
        return { passed: true };
      }
      // Or a [tool.<something>] block at all (means tooling is wired up).
      if (/\[tool\./.test(snap.pyprojectToml)) return { passed: true };
    }
    if (snap.goMod) return { passed: true };
    return {
      passed: false,
      details:
        "no package.json scripts, pyproject [project.scripts], or go.mod — agents won't know how to build",
    };
  },
});

registerCheck({
  id: checkId("SC043"),
  category: "E",
  label: ".gitignore exists",
  maxPoints: 3,
  run: (snap) => {
    if (snap.hasFile(".gitignore")) return { passed: true };
    return {
      passed: false,
      details: "no .gitignore — agents may waste time considering ignored files",
    };
  },
});

registerCheck({
  id: checkId("SC044"),
  category: "E",
  label: "lockfile committed for reproducible installs",
  maxPoints: 4,
  run: (snap) => {
    const hasPkgJson = !!snap.packageJson;
    const hasPyproject = !!snap.pyprojectToml;
    const hasGoMod = !!snap.goMod;
    if (!hasPkgJson && !hasPyproject && !hasGoMod) {
      // Nothing to lock — irrelevant; pass.
      return { passed: true };
    }
    if (hasPkgJson) {
      for (const lf of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]) {
        if (snap.hasFile(lf)) return { passed: true };
      }
      return {
        passed: false,
        details: "package.json present but no lockfile — installs aren't reproducible",
      };
    }
    if (hasPyproject) {
      if (snap.hasFile("poetry.lock") || snap.hasFile("uv.lock") || snap.hasFile("requirements.txt")) {
        return { passed: true };
      }
      return {
        passed: false,
        details: "pyproject.toml present but no poetry.lock / uv.lock / requirements.txt",
      };
    }
    if (hasGoMod) {
      if (snap.hasFile("go.sum")) return { passed: true };
      return {
        passed: false,
        details: "go.mod present but go.sum missing",
      };
    }
    return { passed: true };
  },
});

function collectDeps(pkg: unknown): Set<string> {
  const out = new Set<string>();
  if (typeof pkg !== "object" || pkg === null) return out;
  for (const f of ["dependencies", "devDependencies", "peerDependencies"]) {
    const v = (pkg as Record<string, unknown>)[f];
    if (v && typeof v === "object") for (const k of Object.keys(v)) out.add(k);
  }
  return out;
}
