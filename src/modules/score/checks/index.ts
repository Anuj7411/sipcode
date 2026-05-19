/**
 * Side-effecting barrel — importing this registers every check.
 *
 * Callers (run.ts, command, tests) import this once to populate the
 * registry. The check files themselves call registerCheck() at module load.
 */
import "./a-manifest.js";
import "./b-shape.js";
import "./c-naming.js";
import "./d-docs.js";
import "./e-predictability.js";
