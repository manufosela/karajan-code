// HU-4285 (#4166): kj hu adopt turns an issue that already exists into a card, without a twin.
import { describe, it, expect } from "vitest";
import { adoptHu, BoardRejectedError } from "../src/github-board.js";

const REPO = "acme/app";
const issue = (extra = {}) => ({ number: 187, state: "open", title: "Headings", body: "Fix the headings.\n\nSee docs.", labels: [{ name: "bug" }], ...extra });

function fakeGh(apiAnswer) {
  const calls = [];
  let edited = null;
  const run = async (cmd, args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(" ");
    if (key === "api repos/acme/app/issues/187" || key.startsWith("api repos/acme/app/issues/")) return apiAnswer;
    if (key === "label list") return { exitCode: 0, stdout: JSON.stringify([{ name: "kj:hu" }, { name: "kj:pending" }, ...["running", "done", "failed", "skipped"].map((s) => ({ name: `kj:${s}` })), ...["trivial", "standard", "deep"].map((t) => ({ name: `kj:tier:${t}` }))]) };
    if (key === "issue edit") { edited = args; return { exitCode: 0, stdout: "" }; }
    if (key === "issue list") return { exitCode: 0, stdout: JSON.stringify([{ number: 187, title: "Headings", state: "OPEN", labels: [{ name: "kj:hu" }, { name: "kj:pending" }], assignees: [], body: "" }]) };
    return { exitCode: 0, stdout: "" };
  };
  return { run, calls, edit: () => edited };
}
const answers = (obj) => ({ exitCode: 0, stdout: JSON.stringify(obj) });

describe("adoptHu", () => {
  it("labels an open issue as a pending card, keeps its body above the marker and creates nothing", async () => {
    const { run, calls, edit } = fakeGh(answers(issue()));
    expect(await adoptHu({ repo: REPO, number: 187, run })).toMatchObject({ short_id: "HU-187", number: 187, status: "pending" });
    const args = edit();
    expect(args).toEqual(expect.arrayContaining(["187", "--add-label", "kj:hu", "--add-label", "kj:pending"]));
    expect(args[args.indexOf("--body") + 1]).toBe("Fix the headings.\n\nSee docs.\n\n<!-- kj:hu -->");
    expect(calls.some((a) => a[0] === "issue" && a[1] === "create")).toBe(false);
  });

  it.each([
    ["a pull request", issue({ pull_request: { url: "x" } }), /pull request/],
    ["a closed issue", issue({ state: "closed" }), /closed/],
    ["an issue that already is a card", issue({ labels: [{ name: "kj:hu" }] }), /already is a card/],
  ])("refuses %s and touches nothing", async (_name, answer, why) => {
    const { run, edit } = fakeGh(answers(answer));
    await expect(adoptHu({ repo: REPO, number: 187, run })).rejects.toThrow(why);
    expect(edit()).toBeNull();
  });

  it("refuses a number that does not exist", async () => {
    const { run } = fakeGh({ exitCode: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" });
    await expect(adoptHu({ repo: REPO, number: 187, run })).rejects.toThrow(BoardRejectedError);
    await expect(adoptHu({ repo: REPO, number: 187, run })).rejects.toThrow(/does not exist/);
  });
});
