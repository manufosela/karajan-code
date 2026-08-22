// C2 (KJC-TSK-0778, ADR 0007) — github-workflow adapter against a fake GitHub:
// App JWT → installation token (cached) → workflow_dispatch → the run located
// by creation time; status and a jobs/steps summary; refs never invented.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { appJwt, createGithubWorkflowAdapter, githubKeyFromEnv } from "../../packages/console/src/adapters/github-workflow.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const operation = { id: "sync-docs", adapter: "github-workflow", repo: "org/atlas", workflow: "sync-docs.yml", ref: "main", roles: ["operator"] };
let calls, clock, fetchImpl, adapter, runsAfter;

beforeEach(() => {
  calls = [];
  clock = Date.parse("2026-08-22T10:00:00Z");
  runsAfter = 1; // the run shows up on the Nth poll
  fetchImpl = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.authorization });
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url.endsWith("/access_tokens")) return json(201, { token: "ghs_short", expires_at: new Date(clock + 3600_000).toISOString() });
    if (url.endsWith("/dispatches")) return json(204, null);
    if (url.includes("/runs?event=workflow_dispatch")) {
      const polls = calls.filter((c) => c.url.includes("/runs?event=")).length;
      return json(200, { workflow_runs: polls >= runsAfter ? [{ id: 777, html_url: "https://github.com/org/atlas/actions/runs/777", status: "queued", created_at: new Date(clock + 1000).toISOString() }] : [] });
    }
    if (url.endsWith("/runs/777")) return json(200, { status: "completed", conclusion: "success", html_url: "https://github.com/org/atlas/actions/runs/777", created_at: "x", updated_at: "y" });
    if (url.endsWith("/runs/777/jobs")) return json(200, { jobs: [{ name: "sync", status: "completed", conclusion: "success", steps: [{ name: "checkout", status: "completed", conclusion: "success" }, { name: "ingest", status: "completed", conclusion: "failure" }] }] });
    return json(404, {});
  });
  adapter = createGithubWorkflowAdapter({ github: { appId: 123, installationId: 456, privateKey }, fetchImpl, now: () => clock, sleep: async () => {} });
});

describe("github-workflow adapter", () => {
  it("signs a valid RS256 App JWT (iss = appId, 10 min, iat skewed back)", () => {
    const jwt = appJwt({ appId: 123, privateKey, now: clock });
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url"))).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url"));
    expect(payload).toEqual({ iss: "123", iat: clock / 1000 - 60, exp: clock / 1000 + 540 });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).end().verify(publicKey, s, "base64url")).toBe(true);
  });

  it("dispatch mints an installation token with the JWT, fires workflow_dispatch with ref+inputs and returns the located run", async () => {
    const out = await adapter.dispatch(operation, { corpus: "docs" });
    expect(out).toEqual({ runRef: "github:org/atlas:777", url: "https://github.com/org/atlas/actions/runs/777", status: "queued" });
    const [tok, disp] = calls;
    expect(tok.url).toBe("https://api.github.com/app/installations/456/access_tokens");
    expect(tok.auth).toMatch(/^Bearer ey/);
    expect(disp).toMatchObject({ url: "https://api.github.com/repos/org/atlas/actions/workflows/sync-docs.yml/dispatches", method: "POST", body: { ref: "main", inputs: { corpus: "docs" } }, auth: "Bearer ghs_short" });
  });

  it("the installation token is cached until close to expiry; a refused token is a loud error", async () => {
    await adapter.dispatch(operation);
    await adapter.runStatus("github:org/atlas:777");
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(1);
    clock += 3600_000;
    await adapter.runStatus("github:org/atlas:777");
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(2);
    fetchImpl.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    clock += 3600_000;
    await expect(adapter.runStatus("github:org/atlas:777")).rejects.toThrow(/token refused \(401\)/);
  });

  it("a run that never shows up yields a pending ref with the dispatch instant — never an invented id; bad refs are refused", async () => {
    runsAfter = 99;
    const out = await adapter.dispatch(operation);
    expect(out).toMatchObject({ runRef: `github:org/atlas:pending:${clock}`, status: "pending", dispatchedAt: "2026-08-22T10:00:00.000Z" });
    expect(calls.filter((c) => c.url.includes("/runs?event=")).length).toBe(6);
    // A pending ref is a usable status, never a parse error (review catch).
    expect(await adapter.runStatus(out.runRef)).toMatchObject({ status: "pending", conclusion: null, dispatchedAt: "2026-08-22T10:00:00.000Z" });
    expect(await adapter.runLog(out.runRef)).toMatch(/had not appeared yet/);
    await expect(adapter.runStatus("memory:1")).rejects.toThrow(/not a run ref/);
  });

  it("runStatus and runLog summarise the run; the key comes from the environment only", async () => {
    expect(await adapter.runStatus("github:org/atlas:777")).toMatchObject({ status: "completed", conclusion: "success" });
    expect(await adapter.runLog("github:org/atlas:777")).toBe("sync: completed (success)\n  - checkout: completed (success)\n  - ingest: completed (failure)");
    expect(githubKeyFromEnv({ CONSOLE_GITHUB_APP_KEY: "-----BEGIN\\nabc\\n-----END" })).toBe("-----BEGIN\nabc\n-----END");
    expect(githubKeyFromEnv({})).toBeNull();
    expect(() => createGithubWorkflowAdapter({ github: { appId: 1 } })).toThrow(/never from the config/);
  });
});
