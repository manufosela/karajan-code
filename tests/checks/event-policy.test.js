// HU-5005: kj doctor and kj check warn, like kj harden, when a public repo has no Actions event policy.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createEventPolicyCheck } from "../../src/checks/event-policy.js";
import { runChecks } from "../../src/checks/runner.js";
import { checkCommand } from "../../src/commands/check.js";

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-event-policy-check-"));
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github", "workflows", "kj-policy.yml"), "on:\n  pull_request_target:\njobs: {}\n");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const fakeRun = ({ visibility = "public", policies = [] } = {}) => async (cmd, args) => {
  if (cmd === "git") return { exitCode: 0, stdout: "git@github.com:acme/app.git\n" };
  return { exitCode: 0, stdout: JSON.stringify(args[1].endsWith("/actions/policies") ? { policies } : { visibility }) };
};
const allowed = [{ enforcement: "active", rules: [{ type: "restrict_action_events", parameters: { allowed_events: ["pull_request_target"] } }] }];
const identity = () => {};
const doctorReport = async (run) => (await runChecks([createEventPolicyCheck({ projectDir: dir, run, identity })], { config: {} }, { mode: "check-only" })).checks;

describe("kj doctor: Actions event policy check", () => {
  it("warns (not fails) without the policy or when it cannot be read, with the instructions as the fix", async () => {
    const [missing] = await doctorReport(fakeRun());
    expect([missing.label, missing.status]).toEqual(["Actions event policy", "WARN"]);
    expect(missing.fix).toContain("https://github.com/acme/app/settings/actions");
    const denied = async (cmd, args) => (args[1]?.endsWith("/actions/policies") ? { exitCode: 1, stderr: "HTTP 403" } : fakeRun()(cmd, args));
    const [unverified] = await doctorReport(denied);
    expect(unverified.status).toBe("WARN");
    expect(unverified.fix).toContain("HTTP 403");
  });
  it("passes with the policy and is not listed for a private repo", async () => {
    expect((await doctorReport(fakeRun({ policies: allowed })))[0].status).toBe("OK");
    expect(await doctorReport(fakeRun({ visibility: "private" }))).toEqual([]);
  });
});

describe("kj check: Actions event policy line", () => {
  const output = async (run) => {
    const lines = [];
    await checkCommand({ projectDir: dir, logger: { info: (m) => lines.push(m), error: () => {} }, eventPolicyDeps: { run, identity } });
    return lines.join("\n");
  };
  it("shows the warning without the policy, nothing for a private repo, no warning with the policy", async () => {
    expect(await output(fakeRun())).toContain("⚠ event policy:");
    expect(await output(fakeRun({ visibility: "private" }))).not.toContain("event policy");
    const allowedText = await output(fakeRun({ policies: allowed }));
    expect(allowedText).not.toContain("⚠ event policy");
    expect(allowedText).toContain("pull_request_target is allowed");
  });
});
