// HU-3334: the Linear manager against the story contract; Linear is a fake fetch (no network, no key), documents told apart by their text in Q.
import { describe, expect, it, vi } from "vitest";
import { createLinearManager } from "../src/index.js";
import { Q } from "../src/queries.js";
import { runStoryContract } from "../../story-contract/src/suite.js";
import { assertManager } from "../../story-contract/src/story-contract.js";
import { loadManager } from "../../../src/hu/managers/index.js";

const KEY = "fake-key-for-tests";
const states = { pending: "Todo", running: "In Progress", done: "Done", failed: "Failed", skipped: "Canceled" };
const config = { team: "TRI", states, users: { alice: "alice@acme.test", bob: "bob@acme.test" } };
const json = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, ...init });
const nameOf = (id) => id.slice(2);

function fakeLinear() {
  const issues = new Map();
  const calls = [];
  const backend = { reject: false, labels: [] };
  const view = (i) => ({ ...i, assignee: i.assigneeId ? { id: i.assigneeId, email: i.assigneeId.slice(2) } : null, labels: { nodes: i.labels } });
  const handlers = {
    [Q.team]: () => ({ teams: { nodes: [{ id: "team-1", states: { nodes: Object.values(states).map((n) => ({ id: `s-${n}`, name: n })) } }] } }),
    [Q.labelFind]: (v) => ({ issueLabels: { nodes: backend.labels.filter((l) => l.name === v.name) } }),
    [Q.labelCreate]: (v) => { backend.labels.push({ id: `l-${v.name}`, name: v.name }); return { issueLabelCreate: { success: true, issueLabel: { id: `l-${v.name}` } } }; },
    [Q.create]: ({ input }) => {
      const identifier = `TRI-${issues.size + 1}`;
      issues.set(identifier, { identifier, title: input.title, description: input.description, url: `https://linear.app/acme/issue/${identifier}`, state: { name: nameOf(input.stateId) }, labels: input.labelIds.map((id) => ({ name: nameOf(id) })) });
      return { issueCreate: { success: true, issue: view(issues.get(identifier)) } };
    },
    [Q.get]: (v) => ({ issue: issues.has(v.id) ? view(issues.get(v.id)) : null }),
    [Q.update]: (v) => {
      const i = issues.get(v.id);
      if (v.input.stateId && !backend.reject) i.state = { name: nameOf(v.input.stateId) };
      if (v.input.assigneeId) i.assigneeId = v.input.assigneeId;
      return { issueUpdate: { success: true } };
    },
    [Q.user]: (v) => ({ users: { nodes: v.email.endsWith("@acme.test") ? [{ id: `u-${v.email}`, email: v.email }] : [] } }),
    // Two per page, so any listing of three or more takes several pages.
    [Q.list]: (v) => {
      const from = Number(v.after ?? 0);
      const all = [...issues.values()];
      return { issues: { nodes: all.slice(from, from + 2).map(view), pageInfo: { hasNextPage: from + 2 < all.length, endCursor: String(from + 2) } } };
    },
  };
  const fetch = async (_url, init) => {
    await Promise.resolve(); // lets two concurrent claims interleave, as two machines would
    const { query, variables } = JSON.parse(init.body);
    calls.push({ query, variables, headers: init.headers });
    return json({ data: handlers[query](variables) });
  };
  backend.corrupt = (shortId) => { issues.get(shortId).state = { name: "Weird" }; };
  backend.rejectMoves = () => { backend.reject = true; };
  return { fetch, backend, calls };
}

const make = (fetch) => createLinearManager({ config, apiKey: KEY, fetch });

runStoryContract("Linear", () => {
  const { fetch, backend } = fakeLinear();
  return { manager: make(fetch), backend };
});

describe("Linear manager", () => {
  it("declares its capabilities, credentials and id format", () => {
    const manager = make(fakeLinear().fetch);
    expect(manager.capabilities).toEqual({ acceptanceCriteria: "body", dependencies: "graph", assignee: true, verdicts: "comment", offline: true });
    expect(manager.credentials).toEqual(["LINEAR_API_KEY"]);
    expect(["TRI-12", "tri-12", "HU-12", "TRI-x"].map(manager.isId)).toEqual([true, true, false, false]);
    expect(manager.canonicalId("tri-12")).toBe("TRI-12");
    expect(manager.idHint).toMatch(/TRI-123/);
  });

  it("builds the markdown body and keeps values out of the query text", async () => {
    const { fetch, calls } = fakeLinear();
    const hu = await make(fetch).create({ title: "Login with SSO", acceptanceCriteria: ["a1"], tests: ["t1"], ref: "KJC-TSK-9" });
    expect(calls.find((c) => c.query === Q.create).variables.input.description).toBe("## Acceptance criteria\n- a1\n\n## Tests\n- t1\n\nRef: KJC-TSK-9");
    expect(hu).toMatchObject({ short_id: "TRI-1", url: "https://linear.app/acme/issue/TRI-1" });
    expect(calls.every((c) => c.headers.authorization === KEY && !c.query.includes("Login"))).toBe(true);
  });

  it("pages the listing and creates the label once", async () => {
    const { fetch, backend, calls } = fakeLinear();
    const manager = make(fetch);
    await Promise.all([1, 2, 3].map((n) => manager.create({ title: `t${n}` })));
    expect(backend.labels).toHaveLength(1);
    expect(await manager.list()).toHaveLength(3);
    expect(calls.filter((c) => c.query === Q.list)).toHaveLength(2);
  });

  it("builds through the registry from board.yml, passes assertManager, and the holder reclaims by email", async () => {
    vi.stubGlobal("fetch", fakeLinear().fetch);
    const manager = await loadManager({ backend: "linear", linear: config }, { env: { LINEAR_API_KEY: KEY } });
    vi.unstubAllGlobals(); // the client keeps the fetch it was built with
    expect(() => assertManager(manager)).not.toThrow();
    const { short_id } = await manager.create({ title: "t" });
    await manager.claim(short_id, "alice");
    await manager.move(short_id, "running");
    expect(await manager.claim(short_id, "alice@acme.test")).toMatchObject({ short_id: "TRI-1", claimed_by: "alice" });
  });
});
