// KJC-BUG-0458 (ADR 0040): with several gh accounts and parallel sessions, another session
// switched the active account between `gh auth switch` and kj's own gh calls, so a review
// went out under the wrong account. kj pins GH_TOKEN to the repo's account at startup.
import { describe, it, expect } from "vitest";
import { pinGhAccount, remoteOwner } from "../../src/utils/gh-account.js";

const TOKENS = { manufosela: "tok-personal", "manufosela-tribbu": "tok-work" };
function fakeExec({ remote = "git@github.com:manufosela/karajan-code.git", calls = [] } = {}) {
  return (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd === "git") { if (remote === null) throw new Error("no origin"); return remote; }
    const token = TOKENS[args.at(-1)];
    if (!token) throw new Error("no account");
    return token;
  };
}

describe("remoteOwner", () => {
  it.each([
    ["git@github.com:manufosela/karajan-code.git", "manufosela"],
    ["git@github.com-manufosela:manufosela/karajan-code.git", "manufosela"],
    ["https://github.com/tribbu/portal.git", "tribbu"],
    ["https://github.com/tribbu/portal", "tribbu"],
    ["ssh://git@github.com/owner/repo.git", "owner"],
  ])("%s → %s", (url, owner) => expect(remoteOwner(url)).toBe(owner));

  it("no remote, no owner", () => expect(remoteOwner("")).toBeNull());

  it.each(["git@gitlab.com:foo/bar.git", "https://bitbucket.org/foo/bar", "https://notgithub.com/foo/bar", "https://github.com.evil.dev/foo/bar"])(
    "a host other than github.com has no owner for gh: %s",
    (url) => expect(remoteOwner(url)).toBeNull(),
  );
});

describe("pinGhAccount", () => {
  it("pins the token of the origin's owner for every gh child", () => {
    const env = {};
    expect(pinGhAccount({ env, exec: fakeExec() })).toEqual({ account: "manufosela", reason: null });
    expect(env.GH_TOKEN).toBe("tok-personal");
  });

  it("the configured account wins over the remote's owner", () => {
    const env = {};
    expect(pinGhAccount({ env, account: "manufosela-tribbu", exec: fakeExec() }).account).toBe("manufosela-tribbu");
    expect(env.GH_TOKEN).toBe("tok-work");
  });

  it("a token already in the environment is never overridden, and gh is not asked", () => {
    for (const key of ["GH_TOKEN", "GITHUB_TOKEN"]) {
      const env = { [key]: "ci-token" };
      const calls = [];
      expect(pinGhAccount({ env, exec: fakeExec({ calls }) }).account).toBeNull();
      expect(env.GH_TOKEN ?? env.GITHUB_TOKEN).toBe("ci-token");
      expect(calls).toEqual([]);
    }
  });

  it("an owner gh has no account for (an org) changes nothing and says why", () => {
    const env = {};
    const r = pinGhAccount({ env, exec: fakeExec({ remote: "git@github.com:some-org/repo.git" }) });
    expect(r).toEqual({ account: null, reason: expect.stringMatching(/some-org/) });
    expect(env.GH_TOKEN).toBeUndefined();
  });

  it("no origin remote changes nothing", () => {
    const env = {};
    expect(pinGhAccount({ env, exec: fakeExec({ remote: null }) }).account).toBeNull();
    expect(env.GH_TOKEN).toBeUndefined();
  });
});
