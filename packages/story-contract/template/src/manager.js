import { BoardRejectedError, HuClaimedError } from "@karajan-family/story-contract";

/**
 * A task manager over a `client` for your service. Replace the client calls with real ones;
 * keep the rules: one status per story, read back after every write, the three errors.
 * The client of this template: insert(fields), all(), get(id), setStatus(id, status), setHolder(id, who),
 * each story being { id, title, ref, labels: [status...], holder }.
 */
export function createTemplateManager({ client }) {
  const toHu = (s) => {
    // Opaque ids: short_id is whatever the service minted, never built or parsed by the manager.
    if (s.labels.length !== 1) throw new BoardRejectedError(`${s.id} has ${s.labels.length} statuses: exactly one is expected`);
    return { short_id: s.id, title: s.title, status: s.labels[0], claimed_by: s.holder ?? null, ref: s.ref ?? null };
  };
  /** Not part of the contract, but the core calls it today before a move: a running story held by someone else is theirs. */
  async function assertNotHeld(id, who, release = false) {
    const { status, claimed_by } = toHu(await client.get(id));
    if (status === "running" && claimed_by && claimed_by !== who && !release) throw new HuClaimedError(`${id} is held by ${claimed_by}`);
  }
  const write = {
    move: (id, status) => client.setStatus(id, status),
    claim: async (id, who, { release = false } = {}) => {
      await assertNotHeld(id, who, release);
      await client.setHolder(id, who);
    },
  };
  return {
    idHint: "T-<number>",
    capabilities: { acceptanceCriteria: "body", dependencies: "none", assignee: true, verdicts: "none", offline: true },
    credentials: [], // names of environment variables, e.g. ["MY_SERVICE_TOKEN"]; never the values
    write,
    assertNotHeld,
    list: async () => (await client.all()).map(toHu),
    create: async ({ title, acceptanceCriteria = [], ref }) => toHu(await client.insert({ title, ref, status: "pending", body: acceptanceCriteria.join("\n") })),
    move: async (id, status) => {
      await write.move(id, status);
      const hu = toHu(await client.get(id)); // read back: the service may have disagreed
      if (hu.status !== status) throw new BoardRejectedError(`${id} is ${hu.status} after moving it to ${status}`);
      return hu;
    },
    claim: async (id, who, opts) => {
      await write.claim(id, who, opts);
      return toHu(await client.get(id));
    },
  };
}
