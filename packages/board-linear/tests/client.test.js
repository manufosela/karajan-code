// HU-3384 (epic #3332): the Linear HTTP client with an injected fetch (no network, no real key).
import { describe, expect, it } from "vitest";
import { createClient } from "../src/client.js";
import { Q } from "../src/queries.js";

const KEY = "lin_api_SECRET";
const json = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, ...init });
const client = (fetch) => createClient({ apiKey: KEY, fetch });

describe("Linear client", () => {
  it("posts to the fixed endpoint with the key as Authorization (no Bearer) and values only as variables", async () => {
    const seen = [];
    const fetch = async (url, init) => { seen.push({ url, init }); return json({ data: { viewer: { id: "u1" } } }); };
    await expect(client(fetch)(Q.viewer, { note: "Login with SSO" })).resolves.toEqual({ viewer: { id: "u1" } });
    const [{ url, init }] = seen;
    expect(url).toBe("https://api.linear.app/graphql");
    expect(init).toMatchObject({ method: "POST", headers: { authorization: KEY } });
    const body = JSON.parse(init.body);
    expect(body).toEqual({ query: Q.viewer, variables: { note: "Login with SSO" } });
  });

  it.each([
    ["a network failure", () => { throw new TypeError("fetch failed"); }, "BoardOfflineError", /unreachable/],
    ["a failure while reading the body", () => ({ status: 200, headers: new Headers(), json: async () => { throw new TypeError("terminated"); } }), "BoardOfflineError", /terminated/],
    ["an HTTP 5xx", () => json({}, { status: 503 }), "BoardOfflineError", /503/],
    ["HTTP 429 with Retry-After", () => json({}, { status: 429, headers: { "retry-after": "42" } }), "BoardOfflineError", /42 seconds/],
    ["RATELIMITED in a 200", () => json({ errors: [{ message: "slow down", extensions: { code: "RATELIMITED" } }] }), "BoardOfflineError", /rate limit/],
    ["an HTTP 401", () => json({}, { status: 401 }), "BoardRejectedError", /401/],
    ["a 200 with errors", () => json({ errors: [{ message: "Entity not found" }] }), "BoardRejectedError", /Entity not found/],
  ])("%s gives the right error and never shows the key", async (_name, reply, name, message) => {
    const err = await client(async () => reply())(Q.viewer).catch((e) => e);
    expect(err).toMatchObject({ name, message: expect.stringMatching(message) });
    expect(err.message).not.toContain(KEY);
  });

  it("redacts a key that Linear echoes back in an error", async () => {
    const err = await client(async () => json({ errors: [{ message: `bad key ${KEY}` }] }))(Q.viewer).catch((e) => e);
    expect(err.message).toMatch(/bad key/);
    expect(err.message).not.toContain(KEY);
  });
});
