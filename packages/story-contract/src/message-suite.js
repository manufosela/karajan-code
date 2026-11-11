// EXPERIMENTAL (HU-3792, ADR 0043): the behaviour every message adapter must show.
// `makeAdapter()` returns a fresh adapter each time (a fake of its service, or a test project).
import { describe, it, expect } from "vitest";
import { assertMessageAdapter, PERMISSIONS } from "./message-contract.js";
export function runMessageSuite(name, makeAdapter) {
  describe(`message contract: ${name}`, () => {
    const setup = () => {
      const adapter = makeAdapter();
      assertMessageAdapter(adapter);
      return adapter;
    };
    it("publishes with a stable id, its author and the server time, and lists it back", async () => {
      const adapter = setup();
      const sent = await adapter.publish("t1", "hello");
      expect(sent).toMatchObject({ id: expect.anything(), author: expect.any(String), serverTime: expect.anything() });
      const { messages } = await adapter.listSince("t1", null);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ id: sent.id, author: sent.author, body: "hello" });
      expect(Object.keys(messages[0])).toEqual(expect.arrayContaining(["createdAt", "modifiedAt"]));
    });
    it("lists only what is new after the cursor, in order", async () => {
      const adapter = setup();
      await adapter.publish("t1", "one");
      const first = await adapter.listSince("t1", null);
      await adapter.publish("t1", "two");
      await adapter.publish("t1", "three");
      const next = await adapter.listSince("t1", first.cursor);
      expect(next.messages.map((m) => m.body)).toEqual(["two", "three"]);
      expect((await adapter.listSince("t1", next.cursor)).messages).toEqual([]);
    });
    it("gives a permission level from the known set", async () => {
      expect(PERMISSIONS).toContain(await setup().authorPermission("someone"));
    });
    it("sets and reads labels", async () => {
      const adapter = setup();
      await adapter.setLabel("card-1", "blocked", true);
      expect(await adapter.readLabels("card-1")).toEqual(["blocked"]);
      await adapter.setLabel("card-1", "blocked", false);
      expect(await adapter.readLabels("card-1")).toEqual([]);
    });
    it("opens a conversation of a kind and lists it under that kind only", async () => {
      const adapter = setup();
      await adapter.openConversation("daily", "Daily 2026-11-10");
      expect(await adapter.listConversations("daily")).toHaveLength(1);
      expect(await adapter.listConversations("retro")).toEqual([]);
    });
    it("reads the assignee and the reviewers with their state", async () => {
      const adapter = setup();
      expect(["string", "object"]).toContain(typeof (await adapter.readAssignee("card-1")));
      for (const r of await adapter.readReviewers("change-1")) expect(r).toMatchObject({ user: expect.any(String), state: expect.any(String) });
    });
    it("states its limits", async () => {
      expect(await setup().limits()).toMatchObject({ minPollIntervalMs: expect.any(Number), minWritePauseMs: expect.any(Number), quotaLeft: expect.any(Number) });
    });
  });
}
