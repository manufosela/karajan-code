import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertBoardHomeUntouched, snapshotBoardHome } from "./helpers/real-home-guard.js";

const fresh = () => mkdtempSync(path.join(os.tmpdir(), "kj-guard-"));
const addSession = (home, name, projectId) => {
  const dir = path.join(home, "sessions", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "session.json"), JSON.stringify({ project_id: projectId }));
};
const check = (home, before) => () => assertBoardHomeUntouched(before, ["hu", "add"], home);

describe("e2e real home guard", () => {
  it("passes when nothing is new", () => {
    const home = fresh();
    expect(check(home, snapshotBoardHome(home))).not.toThrow();
  });

  it("throws naming the command and the session for a test project", () => {
    const home = fresh();
    const before = snapshotBoardHome(home);
    addSession(home, "s1", "kj-e2e-03-x");
    expect(check(home, before)).toThrow(/"kj hu add" wrote a session of a test project.*s1/);
  });

  it("does not throw for a new session of a real project", () => {
    const home = fresh();
    const before = snapshotBoardHome(home);
    addSession(home, "s2", "my-real-project");
    expect(check(home, before)).not.toThrow();
  });

  it("passes when the sessions directory is missing", () => {
    const home = fresh();
    expect(snapshotBoardHome(home)).toEqual([]);
    expect(check(home, [])).not.toThrow();
  });

  it("ignores a session that existed before the run", () => {
    const home = fresh();
    addSession(home, "s3", "kj-e2e-before");
    expect(check(home, snapshotBoardHome(home))).not.toThrow();
  });
});
