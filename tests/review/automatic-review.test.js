// HU-4762: a PR without a kj review may count the repo's automatic AI review (codex-state).
import { describe, it, expect } from "vitest";
import { judgeAutomaticReview } from "../../src/review/automatic-review.js";

const HEAD = "a".repeat(40);
const BOT = "github-actions[bot]";
const MARKER = "<!-- codex-review-lifecycle:v1 -->";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const finding = (extra) => ({ id: "F1", path: "src/a.js", line: 7, severity: "minor", category: "style", body: "b", status: "fixed", ...extra });
const state = (extra) => ({ status: "done", findings: [], reviewed: { head: HEAD, base: "b".repeat(40) }, observedHead: HEAD, ...extra });
const body = (s = state(), rec = "APPROVE") => `${MARKER}\n**Recommendation: ${rec}**\n<!-- codex-state:${encode(s)} -->`;
const comment = (text, login = BOT) => ({ body: text, user: { login } });
const dismissed = (severity, by = "maintainer") => finding({ severity, status: "dismissed", dismissal: { by, reason: "r", sha: HEAD, at: "t", comment_id: 1 } });

function judge(overrides = {}) {
  return judgeAutomaticReview({
    comments: [comment(body())], head: HEAD, files: ["src/a.js"], prAuthor: "author",
    canWrite: async (login) => login.toLowerCase() === "maintainer", ...overrides, // GitHub ignores the case of a login
  });
}
const problemsOf = async (s, rec, extra) => (await judge({ comments: [comment(body(s, rec))], ...extra })).problems;

describe("judgeAutomaticReview", () => {
  it("is ok for an approving bot review of the head with nothing open", async () => {
    expect(await problemsOf(state({ findings: [finding(), dismissed("MINOR")] }))).toEqual([]);
    expect(await judge()).toEqual({ ok: true, problems: [] });
  });

  it("never counts when the PR touches a workflow", async () => {
    expect((await judge({ files: ["src/a.js", ".github/workflows/ci.yml"] })).problems).toEqual([expect.stringMatching(/\.github\/workflows\/ci\.yml.*cannot count/)]);
  });

  it("ignores codex-state comments written by anyone but the bot", async () => {
    const res = await judge({ comments: [comment(body(), "github-actions"), comment(`${MARKER} broken`, "mallory")] });
    expect(res.problems).toEqual([expect.stringMatching(/no automatic review by github-actions\[bot\]/)]);
  });

  it("takes the last bot comment when there are several", async () => {
    const stale = body(state(), "REQUEST_CHANGES");
    expect((await judge({ comments: [comment(stale), comment(body()), comment("no marker"), comment(stale, "mallory")] })).ok).toBe(true);
    expect((await judge({ comments: [comment(body()), comment(stale)] })).ok).toBe(false);
  });

  it("names a bot comment that codex-state.js rejects as the one problem", async () => {
    const res = await judge({ comments: [comment(body(state(), "MAYBE"))] });
    expect(res.problems).toEqual([expect.stringMatching(/^codex-state comment: .+: the automatic review cannot count$/)]);
  });

  it("fails when the review is not of the PR head", async () => {
    for (const s of [state({ observedHead: "c".repeat(40) }), state({ reviewed: { head: "c".repeat(40), base: "b".repeat(40) } })]) {
      expect(await problemsOf(s)).toEqual([expect.stringMatching(/latest commit/)]);
    }
  });

  it("fails when the recommendation is not APPROVE", async () => {
    expect(await problemsOf(state(), "REQUEST_CHANGES")).toEqual([expect.stringMatching(/recommends REQUEST_CHANGES/)]);
  });

  it("fails while a finding is active, or has a status it does not know", async () => {
    expect(await problemsOf(state({ findings: [finding({ status: "active" }), finding({ status: "snoozed" })] }))).toEqual([
      expect.stringMatching(/F1 \(MINOR, src\/a\.js:7\) is still active/), expect.stringMatching(/unknown status snoozed/),
    ]);
  });

  it("never accepts a dismissed CRITICAL or MAJOR, naming the finding", async () => {
    const named = (severity) => expect.stringMatching(new RegExp(String.raw`F1 \(${severity}, src/a\.js:7\) was dismissed`));
    expect(await problemsOf(state({ findings: [dismissed("critical"), dismissed("Major")] }))).toEqual([named("CRITICAL"), named("MAJOR")]);
  });

  it("accepts a dismissed MINOR only from someone else with write access", async () => {
    for (const [by, why] of [["author", /PR author/], ["outsider", /no write access/], [null, /no dismissal\.by/]]) {
      expect(await problemsOf(state({ findings: [dismissed("MINOR", by)] }))).toEqual([expect.stringMatching(why)]);
    }
  });

  it("needs the PR author's login, and knows the author in any case of it", async () => {
    for (const prAuthor of ["", undefined]) await expect(judge({ prAuthor })).rejects.toThrow(TypeError);
    expect(await problemsOf(state({ findings: [dismissed("MINOR", "MAINTAINER")] }), "APPROVE", { prAuthor: "Maintainer" })).toEqual([expect.stringMatching(/by the PR author MAINTAINER/)]);
  });

  it("adds one problem per failing rule", async () => {
    const s = state({ observedHead: "c".repeat(40), findings: [finding({ status: "active" })] });
    const res = await judge({ files: [".github/workflows/x.yml"], comments: [comment(body(s, "REQUEST_CHANGES"))] });
    expect(res.problems).toHaveLength(4);
  });
});
