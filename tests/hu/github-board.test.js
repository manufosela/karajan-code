// KJC-TSK-1162 (TEAM-GH-A, ADR 0025): the shared HU Board lives in GitHub Issues. Each HU is
// an issue (its number is the id), its state a kj:<status> label; gh is faked here.
import { describe, it, expect } from "vitest";
import { createHu, listHus, setStatus, claim, assertNotHeld, BoardOfflineError, BoardRejectedError, HuClaimedError } from "../../src/hu/github-board.js";

const REPO = "acme/app";

function fakeGh(responses) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(" ");
    const r = responses[key] ?? { exitCode: 0, stdout: "" };
    return typeof r === "function" ? r(args) : r;
  };
  return { run, calls };
}

describe("createHu", () => {
  it("creates the missing kj labels, then the issue, and names the HU after its number", async () => {
    const { run, calls } = fakeGh({
      "label list": { exitCode: 0, stdout: JSON.stringify([{ name: "kj:hu" }]) },
      "issue create": { exitCode: 0, stdout: "https://github.com/acme/app/issues/42\n" },
    });
    const hu = await createHu({ repo: REPO, title: "Login with SSO", acceptanceCriteria: ["redirects"], tests: ["e2e login"], ref: "KJC-TSK-9", run });
    expect(hu).toEqual({ short_id: "HU-42", number: 42, status: "pending", title: "Login with SSO" });
    const created = calls.filter((a) => a[0] === "label" && a[1] === "create").map((a) => a[2]);
    expect(created).toContain("kj:pending");
    expect(created).not.toContain("kj:hu");
    const issue = calls.find((a) => a[1] === "create" && a[0] === "issue");
    expect(issue).toEqual(expect.arrayContaining(["-R", REPO, "--label", "kj:hu", "--label", "kj:pending"]));
    const body = issue[issue.indexOf("--body") + 1];
    expect(body).toMatch(/- redirects[\s\S]*- e2e login[\s\S]*KJC-TSK-9/);
  });

  it("tells no network apart from GitHub saying no, and never invents an id", async () => {
    const offline = fakeGh({ "label list": { exitCode: 1, stderr: "error connecting to api.github.com: dial tcp: lookup api.github.com: no such host" } });
    await expect(createHu({ repo: REPO, title: "x", run: offline.run })).rejects.toBeInstanceOf(BoardOfflineError);
    const rejected = fakeGh({ "label list": { exitCode: 0, stdout: "[]" }, "issue create": { exitCode: 1, stderr: "HTTP 403: Resource not accessible by integration" } });
    await expect(createHu({ repo: REPO, title: "x", run: rejected.run })).rejects.toBeInstanceOf(BoardRejectedError);
  });
});

describe("listHus", () => {
  it("reads every kj:hu issue with its status label and who holds it", async () => {
    const issues = [
      { number: 7, title: "A", state: "OPEN", labels: [{ name: "kj:hu" }, { name: "kj:running" }], assignees: [{ login: "jorgecasar" }] },
      { number: 8, title: "B", state: "CLOSED", labels: [{ name: "kj:hu" }, { name: "kj:done" }], assignees: [] },
    ];
    const { run, calls } = fakeGh({ "issue list": { exitCode: 0, stdout: JSON.stringify(issues) } });
    expect(await listHus({ repo: REPO, run })).toEqual([
      { short_id: "HU-7", number: 7, title: "A", status: "running", claimed_by: "jorgecasar" },
      { short_id: "HU-8", number: 8, title: "B", status: "done", claimed_by: null },
    ]);
    expect(calls[0]).toEqual(expect.arrayContaining(["--label", "kj:hu", "--state", "all"]));
  });

  it("fails loudly on an issue with no status label or two of them", async () => {
    const issues = [{ number: 9, title: "C", state: "OPEN", labels: [{ name: "kj:hu" }, { name: "kj:done" }, { name: "kj:running" }], assignees: [] }];
    const { run } = fakeGh({ "issue list": { exitCode: 0, stdout: JSON.stringify(issues) } });
    await expect(listHus({ repo: REPO, run })).rejects.toThrow(/HU-9.*status label/);
  });
});

// The issue as gh issue view shows it.
const viewing = ({ status = "pending", state = "OPEN", assignees = [] } = {}) => ({
  exitCode: 0, stdout: JSON.stringify({ state, labels: [{ name: "kj:hu" }, { name: `kj:${status}` }], assignees: assignees.map((login) => ({ login })) }),
});

describe("setStatus", () => {
  // Reads before and after the edit; `after` is what the issue holds once kj wrote it.
  const moving = (before, after) => {
    let views = 0;
    return fakeGh({ "issue view": () => (views++ === 0 ? viewing(before) : viewing(after)) });
  };

  it("leaves only the new status label, closing the issue when the HU is done and reopening it otherwise", async () => {
    const done = moving({ status: "running" }, { status: "done" });
    await setStatus({ repo: REPO, number: 7, status: "done", run: done.run });
    const edit = done.calls.find((a) => a[1] === "edit");
    expect(edit).toEqual(expect.arrayContaining(["--add-label", "kj:done", "--remove-label", "kj:running", "--remove-label", "kj:failed"]));
    const removed = edit.filter((_, i) => edit[i - 1] === "--remove-label");
    expect(removed).toEqual(["kj:pending", "kj:running", "kj:failed", "kj:skipped"]);
    expect(done.calls.some((a) => a[1] === "close")).toBe(true);
    const back = moving({ status: "done", state: "CLOSED" }, { status: "pending", state: "CLOSED" });
    await setStatus({ repo: REPO, number: 7, status: "pending", run: back.run });
    expect(back.calls.some((a) => a[1] === "reopen")).toBe(true);
  });

  it("says so when someone else moved it at the same time", async () => {
    const race = moving({ status: "running" }, { status: "failed" });
    await expect(setStatus({ repo: REPO, number: 7, status: "done", run: race.run })).rejects.toThrow(/moved to failed at the same time/);
  });

  it("refuses a status that is not one of kj's", async () => {
    await expect(setStatus({ repo: REPO, number: 7, status: "doing", run: fakeGh({}).run })).rejects.toThrow(/invalid status "doing"/);
  });
});

// KJC-BUG-0392: HU-0104 (a local id) once resolved to issue #104, which is no HU at all.
describe("an issue that is not a kj HU", () => {
  it("is never moved or claimed", async () => {
    const plain = fakeGh({ "issue view": { exitCode: 0, stdout: JSON.stringify({ state: "OPEN", labels: [{ name: "bug" }], assignees: [] }) } });
    await expect(setStatus({ repo: REPO, number: 104, status: "done", run: plain.run })).rejects.toThrow(/issue #104 is not a kj HU/);
    await expect(claim({ repo: REPO, number: 104, who: "manufosela", run: plain.run })).rejects.toThrow(/not a kj HU/);
    expect(plain.calls.some((a) => a[1] === "edit")).toBe(false);
  });
});

describe("assertNotHeld", () => {
  it("refuses only a running HU someone else holds", async () => {
    const held = fakeGh({ "issue view": viewing({ status: "running", assignees: ["jorgecasar"] }) });
    await expect(assertNotHeld({ repo: REPO, number: 7, who: "manufosela", run: held.run })).rejects.toBeInstanceOf(HuClaimedError);
    await expect(assertNotHeld({ repo: REPO, number: 7, who: "jorgecasar", run: held.run })).resolves.toBeUndefined();
    const done = fakeGh({ "issue view": viewing({ status: "done", assignees: ["jorgecasar"] }) });
    await expect(assertNotHeld({ repo: REPO, number: 7, who: "manufosela", run: done.run })).resolves.toBeUndefined();
  });
});

describe("claim", () => {
  it("assigns a free HU to whoever starts it", async () => {
    let views = 0;
    const { run, calls } = fakeGh({ "issue view": () => (views++ === 0 ? viewing() : viewing({ assignees: ["manufosela"] })) });
    expect(await claim({ repo: REPO, number: 7, who: "manufosela", run })).toEqual({ claimed_by: "manufosela" });
    expect(calls).toContainEqual(expect.arrayContaining(["edit", "7", "--add-assignee", "manufosela"]));
  });

  it("refuses a running HU someone else holds, and --release takes it over explicitly", async () => {
    const held = fakeGh({ "issue view": viewing({ status: "running", assignees: ["jorgecasar"] }) });
    await expect(claim({ repo: REPO, number: 7, who: "manufosela", run: held.run })).rejects.toBeInstanceOf(HuClaimedError);
    await expect(claim({ repo: REPO, number: 7, who: "manufosela", run: held.run })).rejects.toThrow(/HU-7 is held by jorgecasar/);
    // A release keeps it even against a rival that sorts first, and still checks it ends alone.
    const seen = [viewing({ status: "running", assignees: ["jorgecasar"] }), viewing({ status: "running", assignees: ["jorgecasar", "manufosela"] }), viewing({ status: "running", assignees: ["manufosela"] })];
    let views = 0;
    const taken = fakeGh({ "issue view": () => seen[Math.min(views++, 2)] });
    expect(await claim({ repo: REPO, number: 7, who: "manufosela", release: true, run: taken.run })).toEqual({ claimed_by: "manufosela" });
    expect(taken.calls).toContainEqual(expect.arrayContaining(["--add-assignee", "manufosela", "--remove-assignee", "jorgecasar"]));
    expect(views).toBe(3);
  });

  it("two claims at once leave one holder: the first login in order keeps it, the other backs off", async () => {
    // Both saw it free; read back, both are assigned.
    // Views in order: free, both assigned, and (for the winner) alone after removing the rival.
    const race = (final) => {
      const seen = [viewing(), viewing({ assignees: ["jorgecasar", "manufosela"] }), viewing({ assignees: final })];
      let views = 0;
      return fakeGh({ "issue view": () => seen[Math.min(views++, 2)] });
    };
    const loser = race(["jorgecasar"]);
    await expect(claim({ repo: REPO, number: 7, who: "manufosela", run: loser.run })).rejects.toThrow(/claimed at the same time by jorgecasar/);
    expect(loser.calls.at(-1)).toEqual(expect.arrayContaining(["--remove-assignee", "manufosela"]));
    const winner = race(["jorgecasar"]);
    expect(await claim({ repo: REPO, number: 7, who: "jorgecasar", run: winner.run })).toEqual({ claimed_by: "jorgecasar" });
    expect(winner.calls).toContainEqual(expect.arrayContaining(["--remove-assignee", "manufosela"]));
    await expect(claim({ repo: REPO, number: 7, who: "jorgecasar", run: race(["jorgecasar", "manufosela"]).run })).rejects.toThrow(/after a concurrent claim/);
  });
});
