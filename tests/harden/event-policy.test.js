// KJC-BUG-0532: GitHub blocks pull_request_target in public repos without an Actions event policy.
// kj never changes the setting: it reads it and tells the admin what to do.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adviseEventPolicy } from "../../src/harden/event-policy.js";

let dir;
let wf;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-event-policy-"));
  wf = path.join(dir, ".github", "workflows");
  fs.mkdirSync(wf, { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const withWorkflows = () => {
  fs.writeFileSync(path.join(wf, "kj-policy.yml"), "name: Policy\non:\n  pull_request_target:\njobs:\n  p:\n    runs-on: ubuntu-latest\n");
  fs.writeFileSync(path.join(wf, "ci.yml"), "name: CI\non: [push, pull_request]\njobs:\n  t:\n    runs-on: ubuntu-latest\n");
  fs.writeFileSync(path.join(wf, "nightly.yaml"), "name: Nightly\non:\n  schedule:\n    - cron: '0 0 * * *'\n  push:\njobs:\n  n:\n    runs-on: ubuntu-latest\n");
};

const logger = () => {
  const lines = { info: [], warn: [] };
  return { lines, info: (m) => lines.info.push(m), warn: (m) => lines.warn.push(m) };
};

/** gh answers: visibility and the policies call (each a result, or a function). */
const fakeRun = ({ visibility = "public", policies }) => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "git") return { exitCode: 0, stdout: "git@github.com:acme/app.git\n" };
    if (args[1].endsWith("/actions/policies")) return policies();
    return { exitCode: 0, stdout: JSON.stringify({ visibility }) };
  };
  return { run, calls };
};
const policiesOf = (policies) => () => ({ exitCode: 0, stdout: JSON.stringify({ policies }) });
const allowing = (enforcement, events) => ({ enforcement, rules: [{ type: "restrict_action_events", parameters: { allowed_events: events } }] });
const identity = () => {};

describe("adviseEventPolicy", () => {
  it("says nothing and calls no gh without kj-policy.yml", async () => {
    const { run, calls } = fakeRun({ policies: policiesOf([]) });
    expect(await adviseEventPolicy({ projectDir: dir, logger: logger(), run, identity })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("returns null for a private repo", async () => {
    withWorkflows();
    const { run, calls } = fakeRun({ visibility: "private", policies: policiesOf([]) });
    expect(await adviseEventPolicy({ projectDir: dir, logger: logger(), run, identity })).toBeNull();
    expect(calls.some((c) => c[2]?.endsWith("/actions/policies"))).toBe(false);
  });

  it("is ok when an active policy allows pull_request_target", async () => {
    withWorkflows();
    const log = logger();
    const { run } = fakeRun({ policies: policiesOf([allowing("active", ["push", "pull_request_target"])]) });
    const res = await adviseEventPolicy({ projectDir: dir, logger: log, run, identity });
    expect(res.status).toBe("ok");
    expect(log.lines.info[0]).toContain("pull_request_target is allowed");
  });

  it("is missing with no policies, naming every event the workflows use, sorted and unique", async () => {
    withWorkflows();
    const log = logger();
    const { run } = fakeRun({ policies: policiesOf([]) });
    const res = await adviseEventPolicy({ projectDir: dir, logger: log, run, identity });
    expect(res.status).toBe("missing");
    expect(res.events).toEqual(["pull_request", "pull_request_target", "push", "schedule"]);
    const text = log.lines.warn.join("\n");
    expect(text).toContain("2026-12-02");
    expect(text).toContain("pull_request, pull_request_target, push, schedule");
    expect(text).toContain("https://github.com/acme/app/settings/actions");
  });

  it("is unverified when the policies call fails", async () => {
    withWorkflows();
    const log = logger();
    const { run } = fakeRun({ policies: () => ({ exitCode: 1, stdout: "", stderr: "HTTP 403" }) });
    const res = await adviseEventPolicy({ projectDir: dir, logger: log, run, identity });
    expect(res.status).toBe("unverified");
    expect(log.lines.warn.join("\n")).toContain("could not read the Actions event policies (HTTP 403)");
  });

  it("does not count a policy that is not active", async () => {
    withWorkflows();
    const { run } = fakeRun({ policies: policiesOf([allowing("disabled", ["pull_request_target"])]) });
    const res = await adviseEventPolicy({ projectDir: dir, logger: logger(), run, identity });
    expect(res.status).toBe("missing");
  });
});
