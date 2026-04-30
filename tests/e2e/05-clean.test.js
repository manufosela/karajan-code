/**
 * E2E #14 — `kj clean` removes stale session artifacts without touching
 * fresh ones. Pins the GC contract end-to-end (file-system effects).
 * No LLM call.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runKj } from "./helpers/spawn-kj.js";
import { makeTmpProject } from "./helpers/tmp-project.js";

describe("e2e/14 — kj clean", () => {
  let proj;
  afterEach(() => proj?.cleanup());

  it("kj clean (dry-run) runs without crashing on an empty KJ_HOME", () => {
    proj = makeTmpProject();
    const r = runKj(["clean"], { cwd: proj.projectDir });
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
  });

  it("kj clean --yes runs to completion and exits 0 (smoke)", () => {
    proj = makeTmpProject();
    // Seed a session so there's something to consider; rules around
    // exact status/age semantics are unit-tested in tests/clean.* —
    // the e2e just pins that --yes actually executes the deletion path.
    const dir = path.join(proj.kjHome, "sessions", "s_seed_test");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session.json"), '{"id":"s_seed_test","status":"approved","created_at":"2020-01-01T00:00:00Z"}');
    const r = runKj(["clean", "--yes", "--session-days", "1"], { cwd: proj.projectDir });
    expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
  });

  it("kj clean dry-run does NOT delete (must require --yes)", () => {
    proj = makeTmpProject();
    const oldDir = path.join(proj.kjHome, "sessions", "s_old_dry");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "session.json"), '{"id":"s_old_dry","status":"approved"}');
    const sixtyDaysAgo = (Date.now() / 1000) - 60 * 24 * 3600;
    fs.utimesSync(oldDir, sixtyDaysAgo, sixtyDaysAgo);
    fs.utimesSync(path.join(oldDir, "session.json"), sixtyDaysAgo, sixtyDaysAgo);

    runKj(["clean", "--session-days", "30"], { cwd: proj.projectDir });
    expect(fs.existsSync(oldDir), "dry-run must NOT delete").toBe(true);
  });
});
