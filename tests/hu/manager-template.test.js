// HU-3354: the template a community author copies must pass the shared suite, here in the
// root CI (the root vitest excludes packages/**). The service is an in-memory fake.
import { expect, it } from "vitest";
import { createManager } from "../../packages/story-contract/template/src/index.js";
import { runStoryContract } from "../../packages/story-contract/src/suite.js";

function fakeService() {
  const stories = new Map();
  const state = { rejectMoves: false };
  const view = (s) => ({ ...s, labels: [...s.labels] });
  const client = {
    // Yielding lets two concurrent claims interleave, as two machines would.
    insert: async (fields) => { await Promise.resolve(); const id = `T-${stories.size + 1}`; stories.set(id, { id, ...fields, labels: [fields.status], holder: null }); return view(stories.get(id)); },
    all: async () => { await Promise.resolve(); return [...stories.values()].map(view); },
    get: async (id) => { await Promise.resolve(); return view(stories.get(id)); },
    setStatus: async (id, status) => { await Promise.resolve(); if (!state.rejectMoves) stories.get(id).labels = [status]; },
    setHolder: async (id, holder) => { await Promise.resolve(); stories.get(id).holder = holder; },
  };
  const backend = {
    rejectMoves: () => { state.rejectMoves = true; },
    corrupt: (id, n) => { stories.get(id).labels = ["pending", "running"].slice(0, n); },
  };
  return { client, backend };
}

it("the template declares valid capabilities and no credentials", () => {
  const manager = createManager({ config: {}, client: fakeService().client });
  expect(manager.credentials).toEqual([]);
});

runStoryContract("manager template", () => {
  const { client, backend } = fakeService();
  return { manager: createManager({ config: {}, client }), backend };
});
