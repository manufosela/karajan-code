// KJC-TSK-1402 step 3: `kj main-guard-except <pr> --why` is the maintainer's human act: the phone
// signs the exception for the PR's current head, and it is posted as a comment of the PR.
import { describe, expect, it } from "vitest";
import { mainGuardExceptCommand } from "../../src/commands/main-guard-except.js";
import { exceptionFiles } from "../../src/guards/main-guard-exception.js";

const signature = { cid: "c", signer: "k1", signature: "s" };
const ghOf = (calls) => async (args) => {
  calls.push(args);
  if (args[0] === "api" && args[1] === "repos/acme/app/pulls/7") return JSON.stringify({ head: { sha: "abc1234def" } });
  return "https://github.com/acme/app/pull/7#issuecomment-1";
};

describe("kj main-guard-except", () => {
  it("the phone signs this PR's head and reason, and the signed exception is posted on the PR", async () => {
    const calls = [];
    let signed;
    const act = async (files) => { signed = files; return signature; };
    const out = await mainGuardExceptCommand({ repo: "acme/app", pr: "7", why: "transition merge", gh: ghOf(calls), act, print: () => {} });
    expect(signed).toEqual(exceptionFiles({ repo: "acme/app", pr: 7, head: "abc1234def", why: "transition merge" }));
    const post = calls.find((args) => args.includes("--method"));
    expect(post).toEqual(expect.arrayContaining(["repos/acme/app/issues/7/comments"]));
    expect(post.find((a) => a.startsWith("body="))).toMatch(/```kj-exception[\s\S]*"head": "abc1234def"[\s\S]*"why": "transition merge"/);
    expect(out).toMatchObject({ pr: 7, head: "abc1234def" });
  });

  it("refuses an empty reason, a PR that is not a number, and an act with no phone signature", async () => {
    const act = async () => signature;
    await expect(mainGuardExceptCommand({ repo: "acme/app", pr: "7", why: " ", gh: ghOf([]), act })).rejects.toThrow(/--why/);
    await expect(mainGuardExceptCommand({ repo: "acme/app", pr: "x", why: "w", gh: ghOf([]), act })).rejects.toThrow(/PR number/);
    const calls = [];
    await expect(mainGuardExceptCommand({ repo: "acme/app", pr: "7", why: "w", gh: ghOf(calls), act: async () => null })).rejects.toThrow(/phone/);
    expect(calls.some((args) => args.includes("--method"))).toBe(false);
  });
});
