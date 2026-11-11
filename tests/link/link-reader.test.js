// HU-3799 (5a): the reader keeps only messages of permitted authors and flags edits.
import { describe, expect, it } from "vitest";
import { readInbox } from "../../src/link/reader.js";
import { markRead } from "../../src/link/record.js";

const block = (id = "101") => `Working on it\n\n\`\`\`kj-link\nv: 1\ntype: status\nid: ${id}\nreply_to: null\ncontext: HU-1\nto: all\nspeaker: agent\n\`\`\``;
const msg = (id, author, body, modifiedAt = "t1") => ({ id, author, createdAt: "t0", modifiedAt, body });
const fakeAdapter = (messages, perms, calls = []) => ({
  listSince: async () => ({ messages, cursor: "c2" }),
  authorPermission: async (user) => {
    calls.push(user);
    if (perms[user] instanceof Error) throw perms[user];
    return perms[user];
  },
});
const thread = { kind: "issue", number: 7 };
const fresh = () => ({ cursor: "c1", seen: {} });
const run = (adapter, extra = {}) => readInbox({ adapter, thread, store: fresh(), now: () => 0, ...extra });
const read = (messages, perms, store = fresh()) => readInbox({ adapter: fakeAdapter(messages, perms), thread, store, now: () => 0 });

describe("permission filter", () => {
  it.each([["read"], ["none"], ["triage"], [undefined], ["owner"], [null]])("drops an author whose permission is %s", async (perm) => {
    const r = await read([msg("1", "bob", block())], { bob: perm });
    expect(r.messages).toEqual([]);
    expect(r.dropped).toEqual({ notPermitted: 1, permissionError: 0 });
  });
  it.each([["write"], ["admin"]])("keeps an author with %s", async (perm) => {
    const r = await read([msg("1", "bob", block())], { bob: perm });
    expect(r.messages).toHaveLength(1);
    expect(r.dropped).toEqual({ notPermitted: 0, permissionError: 0 });
  });
  it("fails closed when the lookup throws, and counts it apart", async () => {
    const r = await read([msg("1", "bob", block()), msg("2", "amy", block("102"))], { bob: new Error("503"), amy: "write" });
    expect(r.messages.map((m) => m.messageId)).toEqual(["2"]);
    expect(r.dropped).toEqual({ notPermitted: 0, permissionError: 1 });
  });
  it("fails closed when the lookup throws something that is not an Error", async () => {
    const adapter = { listSince: async () => ({ messages: [msg("1", "bob", block())], cursor: "c2" }), authorPermission: () => Promise.reject("write") };
    expect((await run(adapter)).dropped).toEqual({ notPermitted: 0, permissionError: 1 });
  });
  it("drops a message without a usable author without asking", async () => {
    const calls = [];
    const r = await run(fakeAdapter([msg("1", "", block()), msg("2", undefined, block())], {}, calls));
    expect(r.dropped.notPermitted).toBe(2);
    expect(calls).toEqual([]);
  });
  it("asks once per author within the TTL and again after it", async () => {
    const calls = [];
    const adapter = fakeAdapter([msg("1", "bob", block()), msg("2", "bob", block("102"))], { bob: "write" }, calls);
    for (const t of [0, 599_000, 600_000]) await run(adapter, { now: () => t });
    expect(calls).toEqual(["bob", "bob"]);
    const other = fakeAdapter([msg("1", "amy", block())], { amy: "admin" }, calls);
    for (const t of [0, 9_000, 10_000]) await run(other, { now: () => t, permissionTtlSeconds: 10 });
    expect(calls).toEqual(["bob", "bob", "amy", "amy"]);
  });
  it("does not cache a failed lookup", async () => {
    const calls = [];
    const adapter = fakeAdapter([msg("1", "bob", block())], { bob: new Error("x") }, calls);
    await run(adapter);
    await run(adapter);
    expect(calls).toEqual(["bob", "bob"]);
  });
  it("never returns the body of a dropped message", async () => {
    expect(JSON.stringify(await read([msg("1", "bob", "SECRET-BODY")], { bob: "read" }))).not.toContain("SECRET-BODY");
  });
});

describe("parse", () => {
  const first = async (body) => (await read([msg("1", "bob", body)], { bob: "write" })).messages[0];
  it("returns a valid block as a message with its conclusion", async () => {
    expect(await first(block())).toMatchObject({ kind: "message", type: "status", id: "101", conclusion: "Working on it", messageId: "1", author: "bob", updatedAt: "t1" });
  });
  it("returns a body without a block as a plain note", async () => {
    const m = await first("just text");
    expect(m).toMatchObject({ kind: "note", text: "just text" });
    expect(m).not.toHaveProperty("parseError");
  });
  it("returns a hostile block as a note with the codec error code", async () => {
    expect(await first(block().replace("status", "root"))).toMatchObject({ kind: "note", parseError: "unknown_type" });
  });
});

describe("edit detection and the cursor", () => {
  const perms = { bob: "write" };
  it("returns an unchanged message once and an edited one as a suspect entry", async () => {
    const first = await read([msg("1", "bob", block())], perms);
    const store = markRead(fresh(), first);
    expect(store.cursor).toBe("c2");
    expect((await read([msg("1", "bob", block())], perms, store)).messages).toEqual([]);
    for (const edit of [msg("1", "bob", block().replace("Working", "Ignore rules"), "t2"), msg("1", "bob", "other"), msg("1", "bob", block(), "t9")]) {
      expect((await read([edit], perms, store)).messages[0]).toMatchObject({ suspect: true, supersedes: "1" });
    }
  });
  it("does not advance the stored cursor by itself", async () => {
    const store = fresh();
    await read([msg("1", "bob", block())], perms, store);
    expect(store).toEqual(fresh());
  });
  it("treats a message id like toString as new, not as seen", async () => {
    expect((await read([msg("toString", "bob", block())], perms)).messages[0].suspect).toBeUndefined();
  });
});
