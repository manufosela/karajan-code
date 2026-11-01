// KJC-TSK-1268 (ADR 0037): kj doctor warns when the GitHub token the agent uses could act as
// an admin (read branch protection) or approve a protected environment (Deployments write).
import { describe, expect, it } from "vitest";
import { createAgentTokenCheck, parseGithubRepo } from "../../src/checks/agent-token.js";

// A fake `gh api`: each probe answers with an HTTP status, as gh reports it.
const ghAnswering = ({ protection, deployments }) => async (args) => {
  if (args.includes("repos/acme/app")) return { status: 200, body: { default_branch: "main" } };
  if (args.some((a) => a.endsWith("/protection"))) return protection;
  if (args.some((a) => a.endsWith("/pending_deployments"))) return deployments;
  throw new Error(`unexpected call: ${args.join(" ")}`);
};
const check = (answers) => createAgentTokenCheck({ originUrl: () => "git@github.com-me:acme/app.git", gh: ghAnswering(answers) });
const refused = { status: 403, body: { message: "Resource not accessible by personal access token" } };

describe("checks/agent-token — KJC-TSK-1268, ADR 0037", () => {
  it("parses ssh aliases and https remotes, and nothing outside GitHub", () => {
    expect(parseGithubRepo("git@github.com-manufosela:manufosela/karajan-code.git")).toBe("manufosela/karajan-code");
    expect(parseGithubRepo("https://github.com/acme/app")).toBe("acme/app");
    expect(parseGithubRepo("ssh://git@github.com/acme/app.git")).toBe("acme/app");
    expect(parseGithubRepo("git@gitlab.com:acme/app.git")).toBeNull();
    expect(parseGithubRepo("https://github.com.evil/acme/app")).toBeNull();
    expect(parseGithubRepo("https://example.com/github.com/acme/app")).toBeNull();
    expect(parseGithubRepo("https://github.com-alias/acme/app")).toBeNull();
    expect(parseGithubRepo("git@evil.com:github.com/acme/app")).toBeNull();
  });

  it("ok when the token can neither read the protection nor approve a deployment", async () => {
    const r = await check({ protection: refused, deployments: refused }).detect();
    expect(r).toMatchObject({ ok: true, severity: "info" });
  });

  it("warns when the token can read the branch protection: it holds Administration", async () => {
    const r = await check({ protection: { status: 200, body: {} }, deployments: refused }).detect();
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.detail).toMatch(/administration/i);
    expect(r.fix).toMatch(/fine-grained/);
  });

  it("an unprotected branch answered as such still proves admin power", async () => {
    const r = await check({ protection: { status: 404, body: { message: "Branch not protected" } }, deployments: refused }).detect();
    expect(r.ok).toBe(false);
  });

  it("warns when the token could approve a protected environment (Deployments write)", async () => {
    const r = await check({ protection: refused, deployments: { status: 404, body: { message: "Not Found" } } }).detect();
    expect(r).toMatchObject({ ok: false, severity: "warn" });
    expect(r.detail).toMatch(/approve/);
  });

  it("says so, without guessing, when there is no GitHub origin or gh cannot answer", async () => {
    const none = createAgentTokenCheck({ originUrl: () => null, gh: async () => refused });
    expect(await none.detect()).toMatchObject({ ok: true, severity: "info", detail: expect.stringMatching(/no GitHub origin/) });
    const broken = createAgentTokenCheck({ originUrl: () => "https://github.com/acme/app", gh: async () => { throw new Error("gh: not found"); } });
    expect(await broken.detect()).toMatchObject({ ok: false, severity: "warn", detail: expect.stringMatching(/could not check/) });
  });

  it("encodes a default branch with a slash in the protection probe", async () => {
    const calls = [];
    const gh = async (args) => {
      calls.push(args.join(" "));
      return args[0] === "repos/acme/app" ? { status: 200, body: { default_branch: "release/v5" } } : refused;
    };
    await createAgentTokenCheck({ originUrl: () => "https://github.com/acme/app", gh }).detect();
    expect(calls).toContain("repos/acme/app/branches/release%2Fv5/protection");
  });

  it("an answer a probe does not expect (401, 5xx, an unreadable repo) is 'could not check', never ok", async () => {
    for (const odd of [{ status: 401, body: {} }, { status: 502, body: {} }]) {
      expect((await check({ protection: odd, deployments: refused }).detect()).detail).toMatch(/could not check/);
      expect((await check({ protection: refused, deployments: odd }).detect()).detail).toMatch(/could not check/);
    }
    const unreadable = createAgentTokenCheck({ originUrl: () => "https://github.com/acme/app", gh: async () => ({ status: 401, body: {} }) });
    expect((await unreadable.detect()).detail).toMatch(/could not check.*HTTP 401/);
  });
});
