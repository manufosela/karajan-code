// HU-3334 (epic #3332, ADR 0029): Linear as a task manager of the story contract, over the client of part 1.
import { createClient } from "./client.js";
import { validateConfig } from "./config.js";
import { Q } from "./queries.js";
import { BoardRejectedError, HuClaimedError } from "./board-errors.js";

const section = (title, items) => (items.length ? [`## ${title}\n${items.map((i) => `- ${i}`).join("\n")}`] : []);

// HU-3408: Linear's workflow state types, for a state that linear.states does not declare.
const STATUS_OF_TYPE = { triage: "pending", backlog: "pending", unstarted: "pending", started: "running", completed: "done", canceled: "failed" };

export function createLinearManager({ config: raw, apiKey, fetch, warn = console.warn }) {
  const config = validateConfig(raw);
  const gql = createClient({ apiKey, fetch });
  const idPattern = new RegExp(`^${config.team.replaceAll(/\W/g, String.raw`\$&`)}-\\d+$`, "i");
  const holders = Object.fromEntries(Object.entries(config.users).map(([who, email]) => [email.toLowerCase(), who]));
  // The team and label ids, resolved once per manager; a failure is not remembered.
  let resolved;
  const setup = () => (resolved ??= (async () => {
    const [team] = (await gql(Q.team, { key: config.team })).teams.nodes;
    if (!team) throw new BoardRejectedError(`Linear team "${config.team}" not found`);
    const found = (await gql(Q.labelFind, { name: config.label, teamId: team.id })).issueLabels.nodes[0];
    const label = found ?? (await gql(Q.labelCreate, { name: config.label, teamId: team.id })).issueLabelCreate.issueLabel;
    return { teamId: team.id, labelId: label.id, stateIds: Object.fromEntries(team.states.nodes.map((s) => [s.name, s.id])) };
  })().catch((err) => { resolved = undefined; throw err; }));
  const stateIdOf = async (status) => {
    const id = (await setup()).stateIds[config.states[status]];
    if (!id) throw new BoardRejectedError(`invalid status "${status}", or the Linear team has no state "${config.states[status]}"`);
    return id;
  };
  // A declared state name wins; any other state is read by its Linear type; an unknown type maps to nothing.
  const statusOf = ({ identifier, state }) => {
    if (!state) throw new BoardRejectedError(`Linear returned ${identifier} without a state`); // a malformed answer is never an unknown type
    return Object.keys(config.states).find((s) => config.states[s] === state.name) ?? STATUS_OF_TYPE[state.type];
  };
  const unmapped = ({ identifier, state }) => `${identifier} is in the Linear state "${state.name}" of type "${state.type}", which maps to no kj status`;
  const toHu = (issue) => {
    const status = statusOf(issue);
    if (!status) throw new BoardRejectedError(`${unmapped(issue)}: kj does not guess`);
    const email = issue.assignee?.email;
    return { short_id: issue.identifier, title: issue.title, status, claimed_by: email ? (holders[email.toLowerCase()] ?? email) : null, ref: /^Ref: (\S.*)$/m.exec(issue.description ?? "")?.[1].trim() ?? null, url: issue.url };
  };
  const canonicalId = (ref) => {
    if (!idPattern.test(ref)) throw new BoardRejectedError(`"${ref}" is not a ${config.team} issue: use ${config.team}-<number>`);
    return ref.toUpperCase();
  };
  const read = async (ref) => {
    const issue = (await gql(Q.get, { id: canonicalId(ref) })).issue; // only issues kj created as HUs are its to move
    if (!issue) throw new BoardRejectedError(`Linear has no issue ${ref}`);
    if (!issue.labels.nodes.some((l) => l.name === config.label)) throw new BoardRejectedError(`${issue.identifier} is not a kj HU (no ${config.label} label): kj does not touch it`);
    return issue;
  };

  return {
    idHint: `${config.team}-123`,
    capabilities: { acceptanceCriteria: "body", dependencies: "graph", assignee: true, verdicts: "comment", offline: true },
    credentials: ["LINEAR_API_KEY"],
    isId: (ref) => idPattern.test(ref),
    canonicalId,
    async create({ title, acceptanceCriteria = [], tests = [], ref = null }) {
      const { teamId, labelId } = await setup();
      const description = [...section("Acceptance criteria", acceptanceCriteria), ...section("Tests", tests), ...(ref ? [`Ref: ${ref}`] : [])].join("\n\n");
      const input = { teamId, title, description, labelIds: [labelId], stateId: await stateIdOf("pending") };
      return toHu((await gql(Q.create, { input })).issueCreate.issue);
    },
    async list() {
      const hus = [];
      let after = null;
      do {
        const { nodes, pageInfo } = (await gql(Q.list, { team: config.team, label: config.label, after })).issues;
        for (const issue of nodes) {
          if (statusOf(issue)) hus.push(toHu(issue));
          else warn(`${unmapped(issue)}: it is left out`);
        }
        after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      } while (after);
      return hus;
    },
    async move(ref, status) {
      const issue = await read(ref);
      toHu(issue); // refuses a state of an unknown type before writing anything
      const stateId = await stateIdOf(status);
      await gql(Q.update, { id: issue.identifier, input: { stateId } });
      const landed = await read(ref);
      const after = toHu(landed);
      // By state name: two statuses may share a state, and toHu reads that back as the first of them.
      if (landed.state.name !== config.states[status]) throw new BoardRejectedError(`${issue.identifier} is ${after.status} after the move to ${status}: check it before moving it again`);
      return after;
    },
    // Linear has a single assignee: a race is last-writer-wins, and the loser finds the winner on read-back.
    async claim(ref, who, { release = false } = {}) {
      // HU-3420: the code lets the core start a card unassigned when the identity has no Linear user.
      const unmappedError = (why) => Object.assign(new BoardRejectedError(`${why}: add it to linear.users: { "${who}": "<linear email>" }`), { code: "UNMAPPED_IDENTITY" });
      const email = config.users[who] ?? (who.includes("@") ? who : null);
      if (!email) throw unmappedError(`no Linear user mapped for ${who}`);
      const held = await read(ref);
      const heldHu = toHu(held); // refuses a state of an unknown type
      if (held.state.name === config.states.running && held.assignee && held.assignee.email?.toLowerCase() !== email.toLowerCase() && !release) throw new HuClaimedError(`${ref} is held by ${heldHu.claimed_by}: taking it over is explicit (release)`);
      const user = (await gql(Q.user, { email })).users.nodes[0];
      if (!user) throw unmappedError(`no Linear user with the email ${email}`);
      await gql(Q.update, { id: held.identifier, input: { assigneeId: user.id } });
      const after = await read(ref);
      if (after.assignee?.id !== user.id) throw new HuClaimedError(`${ref} is held by ${toHu(after).claimed_by ?? "nobody"} after a concurrent claim: check it before working it`);
      return toHu(after);
    },
  };
}

export const createManager = ({ config, env = process.env, fetch, warn } = {}) => createLinearManager({ config, apiKey: env.LINEAR_API_KEY, fetch, warn });
