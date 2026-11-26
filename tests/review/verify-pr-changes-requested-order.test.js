// HU-4920: the problems follow the order in which each reviewer first appears, and a pending
// review or one with no state does not lift a change request.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { verifyPrReview } from "../../src/review/verify-pr.js";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-verify-cr-order-")); execFileSync("git", ["init", "-q", dir]); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const PR = { headRefOid: "aaa1111", commits: [] };
const review = (login, state) => ({ body: "", author_association: "NONE", user: { login }, state });

const fakeRun = (reviews) => async (cmd, args) => {
  if (cmd === "gh" && args[0] === "pr") return { exitCode: 0, stdout: JSON.stringify(PR) };
  if (cmd === "gh" && args.includes("--jq")) return { exitCode: 0, stdout: reviews.map((r) => JSON.stringify(r)).join("\n") };
  if (cmd === "git") return { exitCode: 0, stdout: "" };
  throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
};

const requesters = async (reviews) => {
  const { problems } = await verifyPrReview({ projectDir: dir, pr: 7, run: fakeRun(reviews) });
  return problems.filter((p) => p.includes("requested changes")).map((p) => p.split(" ")[0]);
};

describe("verify-pr change requests: order and states that change nothing (HU-4920)", () => {
  it("names each reviewer once, in order of first appearance", async () => {
    const reviews = [review("alice", "APPROVED"), review("bob", "CHANGES_REQUESTED"), review("alice", "CHANGES_REQUESTED"), review("bob", "CHANGES_REQUESTED")];
    expect(await requesters(reviews)).toEqual(["alice", "bob"]);
  });

  it.each(["PENDING", undefined])("a later review with state %s does not lift the request", async (state) => {
    expect(await requesters([review("alice", "CHANGES_REQUESTED"), review("alice", state)])).toEqual(["alice"]);
  });
});
