// KJC-TSK-1616 (asked by the maintainer on 2026-11-14): the cast legend, one card per character of
// the factory, as collectable cards: what it does, when it comes out, who calls it and what its
// marks mean. Pure: legend-panel.js draws the cards.

/** The kinds of card, as each one's frame tells them. */
export const KINDS = { agent: 'Agent', crew: 'Crew', piece: 'Method piece', tool: 'Tool', thing: 'In the hall' };

/** KJC-TSK-1617: the cards in one section per kind that has any, in the order of KINDS. */
export const legendSections = (cards, kinds = KINDS) => Object.entries(kinds)
  .map(([kind, title]) => ({ kind, title, cards: cards.filter((card) => card.kind === kind) }))
  .filter((section) => section.cards.length);

const COLOUR = { mark: 'Body colour', means: 'Its AI: Claude orange, Codex lilac, agy mint, any other grey.' };
const BACKPACK = { mark: 'Backpack', means: 'In the colour of the person it works for, with their emblem: every robot of one person carries the same.' };
const LAPTOP = { mark: 'Laptop', means: 'Open and lit in its AI\'s colour while it types.' };

export const CARDS = [
  {
    id: 'host', kind: 'agent', name: 'Host',
    does: 'Your own AI session (Claude Code and the like): it works the lane and calls the others.',
    when: 'While your session works in that lane; it leaves through the door when the session ends.',
    calledBy: 'You, by opening a session. Before a card it walks to atril for its skills.',
    marks: [
      { mark: 'Size', means: 'Bigger than everyone else.' },
      COLOUR,
      { mark: 'Hologram over its head', means: 'Your emblem (or your initial), turning slowly: whose host it is.' },
      { mark: 'Chest plate', means: 'Your emblem again, in your colour.' },
      BACKPACK,
      { mark: 'Label', means: 'Its owner\'s login. "waits for you" in amber, "waits for a process" in blue.' },
    ],
  },
  {
    id: 'teammate', kind: 'agent', name: 'A teammate\'s host',
    does: 'The host of someone else in the same repository, live from their board.',
    when: 'While their session works; it stands in the lane of their card.',
    calledBy: 'Your teammate. Their board shares only role, lane, card, model and avatar.',
    marks: [{ mark: 'Backpack and hologram', means: 'In their colour and with their emblem, never yours.' }, { mark: 'Label', means: 'Their GitHub login.' }],
  },
  {
    id: 'coder', kind: 'agent', name: 'Coder',
    does: 'Writes the code of a card with a clean context and the model its level asks for.',
    when: 'It buds out of Karajan, walks to its desk and melts back into Karajan when it finishes.',
    calledBy: 'Karajan, when the host runs kj code (or kj run).',
    marks: [COLOUR, BACKPACK, LAPTOP],
  },
  {
    id: 'solomon', kind: 'agent', name: 'Solomon',
    does: 'Arbitrates: a third AI decides when the coder and the reviewer do not agree.',
    when: 'Only after the review iterations end without agreement; it goes back when it rules.',
    calledBy: 'Karajan (kj solomon), never the coder or the reviewer.',
    marks: [{ mark: 'Robe and crown', means: 'King Solomon, the judge.' }, COLOUR, BACKPACK],
  },
  {
    id: 'subagent', kind: 'agent', name: 'Subagent',
    does: 'A helper the host opens for one job: a search, a review, a plan.',
    when: 'It buds out of its host and stands in rows in front of the bench until the job ends.',
    calledBy: 'The host, with its Agent tool.',
    marks: [{ mark: 'Size', means: 'Small: it works for the host.' }, BACKPACK],
  },
  {
    id: 'wardrobe', kind: 'agent', name: 'What an agent wears',
    does: 'Tells the model and the effort an agent runs with, at a glance.',
    when: 'On every agent whose model the board knows.',
    calledBy: 'The model and effort it was launched with.',
    marks: [
      { mark: 'Mortarboard', means: 'Fable.' },
      { mark: 'Round glasses', means: 'Opus.' },
      { mark: 'Headphones (the dark band over the head)', means: 'Sonnet.' },
      { mark: 'Cap', means: 'Haiku.' },
      { mark: 'Build', means: 'Its effort: strong for high or more, as drawn for medium, slim for low.' },
    ],
  },
  {
    id: 'conductor', kind: 'crew', name: 'Karajan',
    does: 'Conducts the method: it launches the agents and reacts to what the method decides.',
    when: 'Always, at the end of the row of posts.',
    calledBy: 'A review verdict, a commit at the gates or a Ledger seal turn it to that lane.',
    marks: [{ mark: 'Green, with a baton', means: 'It waves the baton when the work passes and raises its hand when it does not.' }],
  },
  {
    id: 'rag', kind: 'crew', name: 'kaRAGan',
    does: 'The memory: answers questions about the code from the project\'s index.',
    when: 'It walks the answer to the lane that asked; during a reindex it types there.',
    calledBy: 'kj rag query and kj rag index.',
    marks: [{ mark: 'Amber', means: 'Its colour, its laptop\'s too.' }],
  },
  {
    id: 'watch', kind: 'crew', name: 'kaWATCHan',
    does: 'The watchman of the repositories, and keeper of the version counter.',
    when: 'After a release it walks to the counter and sets the new version.',
    calledBy: 'A release.',
    marks: [{ mark: 'Blue', means: 'Its colour.' }],
  },
  {
    id: 'courier', kind: 'crew', name: 'Courier',
    does: 'Carries a card between the wall and its lane, with the card over its head.',
    when: 'When a card is created, started or done; it leaves when the errand ends.',
    calledBy: 'The board, as the card moves.',
    marks: [],
  },
  { id: 'tdd', kind: 'tool', name: 'TDD', does: 'The failing test first, and the suite never left red.', when: 'At its post; it lights when a test run is judged.', calledBy: 'The method, on every change.', marks: [] },
  {
    id: 'sentinel', kind: 'piece', name: 'Sentinel',
    does: 'Checks every tool call of the host against the method, and stops the ones that break it.',
    when: 'On its raised post, turned to the lane it checks; its light blinks on each call it lets through.',
    calledBy: 'Every tool call. On a denial it goes down to that agent, stays a moment and climbs back.',
    marks: [],
  },
  {
    id: 'review', kind: 'piece', name: 'AI review',
    does: 'A different AI reviews the exact diff; its verdict is bound to it.',
    when: 'It goes to the coder\'s side while it reviews. With several reviews at once, a see-through ghost keeps its post.',
    calledBy: 'kj review, before every commit.',
    marks: [{ mark: 'No robot', means: 'The reviewer is this piece, not an agent at a desk.' }],
  },
  { id: 'gates', kind: 'piece', name: 'Git gates', does: 'Let a commit in only with a verdict from another AI; main moves only by PR.', when: 'At its post; the lane\'s gates light with each commit.', calledBy: 'Every commit and push.', marks: [] },
  { id: 'sonar', kind: 'tool', name: 'SonarQube', does: 'Static analysis and a quality gate on the code you change.', when: 'At its post; it lights when the gate is judged.', calledBy: 'The method, before a commit.', marks: [] },
  { id: 'ledger', kind: 'piece', name: 'Ledger', does: 'Seals every command, verdict and exception in a hash chain: the past cannot be rewritten unseen.', when: 'At its post; it lights with each seal.', calledBy: 'Each sealed event.', marks: [] },
  { id: 'steward', kind: 'piece', name: 'Steward', does: 'Re-verifies the guarantees on a schedule; stale evidence stops counting.', when: 'At its post; it lights when it checks.', calledBy: 'Its schedule.', marks: [] },
  {
    id: 'atril', kind: 'tool', name: 'atril',
    does: 'The music stand: skills, commands and subagents, loaded when a task needs them.',
    when: 'Always, by kaRAGan. A host reads at it before starting a card.',
    calledBy: 'kj hu start, when a card brings skills.',
    marks: [],
  },
  { id: 'wall', kind: 'thing', name: 'Task wall', does: 'The project\'s cards in three columns: to do, in progress, done.', when: 'Always, beside the posts.', calledBy: 'The board; couriers pin and fetch its cards.', marks: [] },
  {
    id: 'release', kind: 'thing', name: 'Ready to release',
    does: 'A table with the cards done since the last release, and the counter with that release.',
    when: 'Always; the pile grows with each card done.',
    calledBy: 'Cards done. A release empties it.',
    marks: [],
  },
  { id: 'drone', kind: 'thing', name: 'Release drone', does: 'Lifts the "Ready to release" pile and flies away with it.', when: 'When a release is published.', calledBy: 'A release.', marks: [] },
  {
    id: 'mailbox', kind: 'thing', name: 'Mailbox',
    does: 'Holds what the agents left for you to do (handoffs).',
    when: 'Always, at the front right of the factory.',
    calledBy: 'kj handoff add.',
    marks: [{ mark: 'Amber glow, blinking', means: 'Something waits for you.' }],
  },
];
