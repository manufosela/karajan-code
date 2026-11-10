// The message contract's own checks, and an in-memory adapter passing the shared message suite.
import { describe, it, expect } from "vitest";
import { assertMessageAdapter, messageCapabilities, MESSAGE_OPERATIONS, MESSAGE_CAPABILITIES, PERMISSIONS, MessageGuaranteeError } from "../src/index.js";
import { runMessageSuite } from "../src/message-suite.js";
const makeAdapter = () => {
  const threads = new Map();
  const labels = new Map();
  const conversations = [];
  let clock = 1000;
  const thread = (id) => threads.get(id) ?? threads.set(id, []).get(id);
  return {
    capabilities: { tasks: true, reviews: true, labels: true, ceremonies: true, notice: false, edit_history: false },
    guarantees: { stableMessageId: true, serverTime: true },
    publish: async (id, body) => {
      const message = { id: `m${thread(id).length + 1}`, author: "alice", createdAt: ++clock, modifiedAt: clock, body };
      thread(id).push(message);
      return { id: message.id, author: message.author, serverTime: message.createdAt };
    },
    listSince: async (id, cursor) => {
      const all = thread(id);
      return { messages: all.slice(cursor ?? 0), cursor: all.length };
    },
    readAssignee: async () => "alice",
    readReviewers: async () => [{ user: "bob", state: "approved" }],
    setLabel: async (card, label, on) => {
      const set = labels.get(card) ?? new Set();
      on ? set.add(label) : set.delete(label);
      labels.set(card, set);
    },
    readLabels: async (card) => [...(labels.get(card) ?? [])],
    authorPermission: async (user) => (user === "alice" ? "write" : "none"),
    openConversation: async (kind, title) => {
      conversations.push({ id: `c${conversations.length + 1}`, kind, title });
      return conversations.at(-1);
    },
    listConversations: async (kind) => conversations.filter((c) => c.kind === kind),
    limits: async () => ({ minPollIntervalMs: 60000, minWritePauseMs: 1000, quotaLeft: 4000 }),
  };
};
describe("assertMessageAdapter", () => {
  it("accepts an adapter with the ten operations and the guarantees", () => {
    expect(MESSAGE_OPERATIONS).toHaveLength(10);
    expect(PERMISSIONS).toEqual(["none", "read", "write", "admin"]);
    expect(() => assertMessageAdapter(makeAdapter())).not.toThrow();
  });
  it("names the operations that are missing", () => {
    expect(() => assertMessageAdapter({ ...makeAdapter(), limits: undefined })).toThrow(/limits/);
    expect(() => assertMessageAdapter(null)).toThrow(/adapter/);
  });
  it.each([
    ["authorPermission", { authorPermission: undefined }],
    ["a stable message id", { guarantees: { stableMessageId: false, serverTime: true } }],
    ["a server time", { guarantees: { stableMessageId: true } }],
  ])("refuses an adapter that cannot give %s", (what, change) => {
    expect(() => assertMessageAdapter({ ...makeAdapter(), ...change })).toThrow(MessageGuaranteeError);
    expect(() => assertMessageAdapter({ ...makeAdapter(), ...change })).toThrow(new RegExp(what));
  });
  it("fails loud on a capability that is not a boolean", () => {
    const adapter = { ...makeAdapter(), capabilities: { ...makeAdapter().capabilities, notice: "push" } };
    expect(() => assertMessageAdapter(adapter)).toThrow(/notice.*"push"/);
  });
});
describe("messageCapabilities", () => {
  it("reports every capability absent for a manager without the message interface", () => {
    expect(Object.keys(messageCapabilities({ create() {} }))).toEqual(MESSAGE_CAPABILITIES);
    expect(Object.values(messageCapabilities({ create() {} })).every((v) => v === false)).toBe(true);
  });
  it("reports what an adapter declares, missing ones as false", () => {
    expect(messageCapabilities({ ...makeAdapter(), capabilities: { tasks: true } })).toMatchObject({ tasks: true, reviews: false });
  });
});
runMessageSuite("in-memory fake", makeAdapter);
