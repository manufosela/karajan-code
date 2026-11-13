/**
 * The body of a release proposal issue (ADR 0057, step 2): readable for people, with a JSON block
 * at the end that the later steps (ack, approve, CI) parse.
 */
const OPEN = "<!-- kj-release:proposal ";
const CLOSE = "-->";
// "--" inside an HTML comment would end it early ("-->"), so each "-" of it goes out as its JSON
// unicode escape, which JSON.parse turns back. Outside strings JSON never has "--": nothing is lost.
const ESCAPED_DASHES = String.raw`\u002d\u002d`;
/** A JSON block in an HTML comment: `<!-- <marker> {json} -->`, safe against "--" in its strings. */
export const commentBlock = (marker, data) => `<!-- ${marker} ${JSON.stringify(data).replaceAll("--", ESCAPED_DASHES)} ${CLOSE}`;
export const RELEASE_BLOCK = (data) => commentBlock("kj-release:proposal", data);

const who = (entry) => (entry.login ? `@${entry.login}` : entry.who);

function goingOutSection(goingOut) {
  const lines = ["## Going out", ""];
  for (const entry of goingOut) {
    lines.push(who(entry), ...entry.commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.subject}`), "");
  }
  return lines;
}

function stayingOutSection(stayingOut) {
  if (stayingOut.length === 0) return ["## Staying out", "", "Nothing is in flight: no open pull requests.", ""];
  const lines = ["## Staying out", ""];
  for (const entry of stayingOut) {
    lines.push(who(entry), ...entry.prs.map((p) => `- #${p.number} ${p.title}${p.draft ? " (draft)" : ""}`), "");
  }
  return lines;
}

/** @returns {string} markdown body of the release issue */
export function renderProposal({ repo, version, tag, head, goingOut, stayingOut, participants, deadline }) {
  const iso = new Date(deadline).toISOString();
  return [
    `Proposed: release ${version} of ${repo} from candidate commit ${head.slice(0, 7)}, on top of ${tag}. ` +
      `Answer before ${iso} (UTC): silence after it counts as no objection, while a hold always blocks.`,
    "",
    ...goingOutSection(goingOut),
    ...stayingOutSection(stayingOut),
    "## How to answer",
    "",
    "From your own session: `kj release ack <issue> ok|hold|include`.",
    "",
    RELEASE_BLOCK({ version, candidate: head, base: tag, deadline: iso, participants }),
    "",
  ].join("\n");
}

/**
 * The JSON of the block that ends the body; throws when there is none or it is not a valid object.
 * Only the last marker counts: the commit subjects and PR titles above it are a contributor's free
 * text, and one of them may hold a proposal-like comment.
 */
export function parseProposal(body) {
  const text = String(body ?? "");
  const start = text.lastIndexOf(OPEN);
  if (start === -1) throw new Error("The issue has no kj-release proposal block");
  // An HTML comment ends at its first "-->", and the block's own JSON never holds "--" (RELEASE_BLOCK).
  const end = text.indexOf(CLOSE, start + OPEN.length);
  if (end === -1 || text.slice(end + CLOSE.length).trim() !== "") {
    throw new Error(`The kj-release proposal block must be the end of the issue: closed by "${CLOSE}", only whitespace after it`);
  }
  const json = text.slice(start + OPEN.length, end).trim();
  if (!json.startsWith("{")) throw new Error("The kj-release proposal block is not a JSON object");
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`The kj-release proposal block is not valid JSON: ${error.message}`, { cause: error });
  }
}
