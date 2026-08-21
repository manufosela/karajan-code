// C1 (KJC-TSK-0777, ADR 0007) — gcp-cloud-run adapter against a fake Google:
// health via the service uri with an ID token, access as the invoker binding
// of the service (read-modify-write, other bindings untouched).
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createCloudRunAdapter } from "../../packages/console/src/adapters/gcp-cloud-run.js";

const corpus = { id: "code", adapter: "gcp-cloud-run", project: "p", region: "europe-west1", service: "atlas-code", healthPath: "/health" };
const SVC = "https://run.googleapis.com/v2/projects/p/locations/europe-west1/services/atlas-code";
let policy, calls, auth, adapter;

beforeEach(() => {
  policy = { etag: "e1", bindings: [{ role: "roles/run.admin", members: ["serviceAccount:console@p.iam"] }, { role: "roles/run.invoker", members: ["user:a@example.com"] }] };
  calls = [];
  auth = {
    request: vi.fn(async ({ url, method, data }) => {
      calls.push({ url, method, data });
      if (url === SVC) return { data: { uri: "https://atlas-code-xyz.a.run.app/" } };
      if (url === `${SVC}:getIamPolicy`) return { data: structuredClone(policy) };
      if (url === `${SVC}:setIamPolicy`) { policy = structuredClone(data.policy); return { data: policy }; }
      throw new Error(`unexpected ${method} ${url}`);
    }),
    idToken: vi.fn(async (audience) => `id-token-for:${audience}`),
  };
  adapter = createCloudRunAdapter({ auth });
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => ({ ok: true, status: 200, json: async () => ({ fingerprint: "transformers|384", files: 7511, chunks: 35165, url, authorization: opts.headers.authorization }) })));
});
afterEach(() => vi.unstubAllGlobals());

describe("gcp-cloud-run adapter", () => {
  it("health: resolves the service uri, mints an ID token for it and GETs healthPath", async () => {
    const h = await adapter.health(corpus);
    expect(h).toMatchObject({ ok: true, corpus: "code", uri: "https://atlas-code-xyz.a.run.app/", fingerprint: "transformers|384", chunks: 35165 });
    expect(fetch).toHaveBeenCalledWith("https://atlas-code-xyz.a.run.app/health", { headers: { authorization: "Bearer id-token-for:https://atlas-code-xyz.a.run.app/" } });
  });

  it("health reports a non-2xx without throwing and a missing uri loudly", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    expect(await adapter.health(corpus)).toMatchObject({ ok: false, status: 403 });
    auth.request.mockResolvedValueOnce({ data: {} });
    await expect(adapter.health(corpus)).rejects.toThrow(/no uri/);
  });

  it("listAccess returns the invoker users of THAT service only", async () => {
    expect(await adapter.listAccess(corpus)).toEqual(["a@example.com"]);
  });

  it("grant adds user:<email> to the invoker binding, keeps the other bindings and the etag, and is idempotent", async () => {
    expect(await adapter.grant(corpus, "B@Example.com")).toEqual({ granted: "b@example.com", changed: true });
    const set = calls.find((c) => c.url.endsWith(":setIamPolicy"));
    expect(set.data.policy.etag).toBe("e1");
    expect(set.data.policy.bindings).toEqual([
      { role: "roles/run.admin", members: ["serviceAccount:console@p.iam"] },
      { role: "roles/run.invoker", members: ["user:a@example.com", "user:b@example.com"] },
    ]);
    expect(await adapter.grant(corpus, "b@example.com")).toEqual({ granted: "b@example.com", changed: false });
    expect(calls.filter((c) => c.url.endsWith(":setIamPolicy"))).toHaveLength(1);
  });

  it("revoke removes the user; revoking the last one drops the binding; unknown user is a no-op", async () => {
    expect(await adapter.revoke(corpus, "a@example.com")).toEqual({ revoked: true });
    expect(policy.bindings.some((b) => b.role === "roles/run.invoker")).toBe(false);
    expect(await adapter.revoke(corpus, "nobody@example.com")).toEqual({ revoked: false });
    expect(() => createCloudRunAdapter({ auth: {} })).toThrow(/auth\.request/);
  });
});
