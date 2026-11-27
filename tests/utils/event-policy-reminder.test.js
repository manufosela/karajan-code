// HU-5005: any kj command reminds, once a day per repo, that a public repo lacks the Actions event policy.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { printEventPolicyReminder } from "../../src/utils/event-policy-reminder.js";

const NOW = Date.UTC(2026, 10, 27, 12);
const HOUR = 60 * 60 * 1000;
let home, repo, lines;
beforeEach(() => {
  [home, repo] = ["home", "repo"].map((n) => fs.mkdtempSync(path.join(os.tmpdir(), `kj-ep-${n}-`)));
  fs.mkdirSync(path.join(repo, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".github", "workflows", "kj-policy.yml"), "on: [pull_request_target]\njobs: {}\n");
  lines = [];
});
afterEach(() => [home, repo].forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** git: the repo root (none when origin is "") and the origin; gh: a public repo with no policies. */
const fakeRun = (origin = "git@github.com:acme/app.git", calls = []) => async (cmd, args) => {
  calls.push(cmd);
  if (args.includes("rev-parse")) return origin ? { exitCode: 0, stdout: repo } : { exitCode: 128 };
  if (cmd === "git") return { exitCode: 0, stdout: origin };
  return { exitCode: 0, stdout: args[1].endsWith("/policies") ? '{"policies":[]}' : '{"visibility":"public"}' };
};
const remind = (run, opts = {}) => printEventPolicyReminder({ cwd: repo, now: NOW, home, env: {}, write: (s) => lines.push(s), run, identity: () => {}, ...opts });

describe("printEventPolicyReminder", () => {
  it("prints once a day per repo: not again the same day, again for another repo or the next day", async () => {
    const calls = [];
    await remind(fakeRun(undefined, calls));
    expect(lines[0]).toContain("https://github.com/acme/app/settings/actions");
    await remind(fakeRun(undefined, calls), { now: NOW + 2 * HOUR });
    expect(lines).toHaveLength(1);
    expect(calls.filter((c) => c === "gh")).toHaveLength(2);
    await remind(fakeRun("https://github.com/acme/other.git"));
    expect(lines[1]).toContain("https://github.com/acme/other/settings/actions");
    await remind(fakeRun(), { now: NOW + 25 * HOUR });
    expect(lines).toHaveLength(3);
  });

  it("stamps nothing when gh cannot answer, so the next command the same day still warns", async () => {
    await remind(async (cmd, args) => (cmd === "gh" ? { exitCode: 1, stderr: "HTTP 502" } : fakeRun()(cmd, args)));
    await remind(fakeRun(), { now: NOW + HOUR });
    expect(lines).toEqual([expect.stringContaining("https://github.com/acme/app/settings/actions")]);
  });

  it("ends within its timeout when gh never answers, stamping nothing, and asks run to kill the child", async () => {
    const opts = [];
    await remind(async (cmd, args, o) => { opts.push(o); return cmd === "gh" ? new Promise(() => {}) : fakeRun()(cmd, args); }, { timeoutMs: 50 });
    expect([lines, opts.at(-1)]).toEqual([[], { timeout: 50 }]);
    await remind(fakeRun(), { now: NOW + HOUR });
    expect(lines).toHaveLength(1);
  }, 1000);

  it("is silent and calls nothing with KJ_NO_UPDATE_CHECK=1", async () => {
    const calls = [];
    await remind(fakeRun(undefined, calls), { env: { KJ_NO_UPDATE_CHECK: "1" } });
    expect([lines, calls]).toEqual([[], []]);
  });

  it("does nothing outside a git repo or without a GitHub origin, and never throws", async () => {
    const calls = [];
    await remind(fakeRun("", calls));
    await remind(fakeRun("git@gitlab.com:acme/app.git", calls));
    await expect(remind(async () => { throw new Error("boom"); })).resolves.toBeUndefined();
    expect(lines).toEqual([]);
    expect(calls).not.toContain("gh");
  });
});
