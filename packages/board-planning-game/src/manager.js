// KJC-TSK-1417: the Planning Game as a task manager of the story contract (ADR 0029), over the
// client of its MCP server. Step 3a: reading a card as a story, creating cards and claiming them.
// Moving (step 3b) and listing (after PLN-TSK-0367, which paginates list_cards) come next.
import { BoardRejectedError, HuClaimedError } from "./board-errors.js";
import { kjStatusOf, validateConfig } from "./config.js";

// Read only: a card its validator approved is done, a reopened one is being worked again.
const READ_ALIASES = { "Done&Validated": "done", Reopened: "running" };
const day = (date) => date.toISOString().slice(0, 10);

/**
 * @param {{config: object, client: object, now?: () => Date, evidence?: (cardId: string) => Promise<{commits: object[], pr: object|null}|null>}} opts
 *   evidence: the commits and the merged PR that name a card, which the Planning Game asks for to finish it.
 */
export function createPlanningGameManager({ config: raw, client, now = () => new Date(), evidence = async () => null }) {
  const config = validateConfig(raw);
  const project = config.project.replaceAll(/\W/g, String.raw`\$&`);
  const idPattern = new RegExp(`^${project}-TSK-\\d+$`, "i");
  const holders = Object.fromEntries(Object.entries(config.users).map(([who, dev]) => [dev, who]));

  const toHu = (card) => {
    const status = kjStatusOf(card.status, config.states) ?? READ_ALIASES[card.status];
    if (!status) throw new BoardRejectedError(`${card.cardId} is in the Planning Game state "${card.status}", which maps to no kj status: kj does not guess`);
    const ref = /^Ref: (\S.*)$/m.exec(card.notes ?? "")?.[1].trim() ?? null;
    return { short_id: card.cardId, title: card.title, status, claimed_by: card.developer ? (holders[card.developer] ?? card.developer) : null, ref, url: null };
  };
  const canonicalId = (ref) => {
    if (!idPattern.test(ref)) throw new BoardRejectedError(`"${ref}" is not a ${config.project} task: use ${config.project}-TSK-<number>`);
    return ref.toUpperCase();
  };
  const fetchCard = async (ref) => {
    const { card } = await client.call("get_card", { projectId: config.project, cardId: canonicalId(ref) });
    if (!card) throw new BoardRejectedError(`the Planning Game has no card ${ref}`);
    return card;
  };
  const write = (card, updates) => client.call("update_card", { projectId: config.project, type: "task", firebaseId: card.firebaseId, updates });
  // One sprint per day (the owner's convention); create_sprint returns the day's one when it exists.
  const sprintOfToday = async () => {
    const d = day(now());
    const listed = await client.call("list_sprints", { projectId: config.project });
    const total = Array.isArray(listed) ? (listed.find((s) => s?._totalItems)?._totalItems ?? listed.length) : 0;
    const { cardId } = await client.call("create_sprint", { projectId: config.project, title: `Sprint ${total + 1} - ${d.replaceAll("-", "")}`, startDate: d, endDate: d });
    return cardId;
  };
  // What each Planning Game transition asks for, beyond the state; the Planning Game still judges the move.
  const fieldsFor = {
    running: async (card) => ({ developer: card.developer ?? config.developer, sprint: await sprintOfToday(), ...(!card.startDate && { startDate: day(now()) }) }),
    done: async (card) => {
      const { commits = [], pr = null } = (await evidence(card.cardId)) ?? {};
      const missing = [!commits.length && "no commit names it", !pr && "no merged PR names it"].filter(Boolean);
      if (missing.length) throw new BoardRejectedError(`${card.cardId} cannot be finished: ${missing.join(" and ")} (the Planning Game asks for both)`);
      return { endDate: day(now()), commits, pipelineStatus: { prCreated: pr } };
    },
    failed: async (card) => ({ blockedByDevelopment: true, bbdWhy: "marked failed by kj hu move", bbdWho: card.developer ?? config.developer }),
  };

  return {
    idHint: `${config.project}-TSK-0001`,
    capabilities: { acceptanceCriteria: "field", dependencies: "none", assignee: true, verdicts: "none", offline: true },
    credentials: [],
    isId: (ref) => idPattern.test(ref),
    canonicalId,
    read: async (ref) => toHu(await fetchCard(ref)),
    // The story (as/want/so) and the points are what the Planning Game asks for; kj hu add requires
    // them with this manager, and the Planning Game itself refuses a card without them.
    async create({ title, acceptanceCriteria = [], tests = [], ref = null, story = null, devPoints, businessPoints }) {
      const args = {
        projectId: config.project, type: "task", title, epic: config.epic, validator: config.validator,
        acceptanceCriteria: [...acceptanceCriteria, ...tests.map((t) => `Test: ${t}`)].join("\n"),
        ...(story && { descriptionStructured: [{ role: story.as, goal: story.want, benefit: story.so }] }),
        ...(devPoints !== undefined && { devPoints }),
        ...(businessPoints !== undefined && { businessPoints }),
        ...(ref && { notes: `Ref: ${ref}` }),
      };
      const { cardId } = await client.call("create_card", args);
      return toHu(await fetchCard(cardId));
    },
    async move(ref, status) {
      const target = config.states[status];
      if (!target) throw new BoardRejectedError(`invalid status "${status}" (allowed: ${Object.keys(config.states).join(", ")})`);
      const card = await fetchCard(ref);
      toHu(card); // refuses a state kj does not map before writing anything
      await write(card, { status: target, ...(fieldsFor[status] ? await fieldsFor[status](card) : {}) });
      const landed = await fetchCard(ref);
      if (landed.status !== target) throw new BoardRejectedError(`${card.cardId} is ${toHu(landed).status} after the move to ${status}: check it before moving it again`);
      return toHu(landed);
    },
    // The Planning Game has one developer per card: a race is last-writer-wins, and the loser finds the winner on read-back.
    async claim(ref, who, { release = false } = {}) {
      const dev = config.users[who] ?? (/^dev_\w+$/.test(who) ? who : null);
      if (!dev) throw new BoardRejectedError(`no Planning Game developer mapped for ${who}: add it to planning-game.users`);
      const held = await fetchCard(ref);
      const heldHu = toHu(held);
      if (heldHu.status === "running" && held.developer && held.developer !== dev && !release) {
        throw new HuClaimedError(`${heldHu.short_id} is held by ${heldHu.claimed_by}: taking it over is explicit (release)`);
      }
      await write(held, { developer: dev });
      const after = await fetchCard(ref);
      if (after.developer !== dev) throw new HuClaimedError(`${heldHu.short_id} is held by ${toHu(after).claimed_by ?? "nobody"} after a concurrent claim: check it before working it`);
      return toHu(after);
    },
  };
}
