/**
 * The coder gets the CARD, not just a sentence (KJC-TSK-0864).
 *
 * `kj code` handed the agent a bare task string: no card, no acceptance
 * criteria, not even the project boundary the pipeline always passed. That is
 * the gap the user hit, because when the host orchestrates instead of
 * `kj run`, `kj code` IS the way the declared coder gets invoked, and a coder
 * without the card writes to a sentence instead of to a contract.
 *
 * A local HU is read from the board. A reference kj cannot read (an external
 * board lives in the host's own MCP, not here) travels as the reference it is
 * and says so: the coder learns the card exists and where to ask for it,
 * instead of receiving a silently empty context.
 */
import { getHu } from "../hu/store.js";

/** Ids minted by the HU Board; anything else belongs to an external board. */
const LOCAL_HU = /^HU-/i;

const externalSection = (ref) =>
  [
    `## Card ${ref}`,
    "",
    `This work is tracked as ${ref} on the project's own board, which kj cannot read from here.`,
    "Treat the task below as the card's statement, and if something the card should answer is missing, ASK instead of guessing.",
  ].join("\n");

const localSection = (hu) => {
  const lines = [`## Card ${hu.id} — ${hu.title}`, ""];
  if (hu.description?.trim()) lines.push(hu.description.trim(), "");
  lines.push(`Status on the board: ${hu.status}. The card is the contract: done means its statement is literally true.`);
  return lines.join("\n");
};

/**
 * @param {{projectDir: string, ref: string|null, deps?: {getHu?: Function}}} args
 * @returns {Promise<null|{huId: string, title: string|null, section: string,
 *   acceptanceTests: Array|null, external: boolean}>}
 */
export async function resolveCardContext({ projectDir, ref, deps = {} }) {
  if (!ref?.trim()) return null;
  const id = ref.trim();
  if (!LOCAL_HU.test(id)) {
    return { huId: id, title: null, section: externalSection(id), acceptanceTests: null, external: true };
  }
  // A missing local HU is an error, never an empty context: the caller asked
  // for a card by id and kj either delivers it or says it does not exist.
  const hu = await (deps.getHu || getHu)(projectDir, id);
  const criteria = hu.acceptanceCriteria?.trim();
  return {
    huId: hu.id,
    title: hu.title,
    section: localSection(hu),
    acceptanceTests: criteria ? [{ type: "gherkin", content: criteria }] : null,
    external: false,
  };
}
