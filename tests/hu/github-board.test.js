// KJC-TSK-1162 (TEAM-GH-A, ADR 0025): the shared HU Board lives in GitHub Issues. Each HU is
// an issue (its number is the id), its state a kj:<status> label; gh is faked here.
import { describe, it, expect } from "vitest";
import { createHu, listHus, BoardOfflineError, BoardRejectedError } from "../../src/hu/github-board.js";

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
