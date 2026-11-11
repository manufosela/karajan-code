// HU-3800 (ADR 0043 item 6): a ceremony is a dedicated issue. The rule D5 (title and label) is the owner's open
// decision and lives ONLY here, so deciding it later is a change to these constants.
export const CEREMONY_KINDS = ["daily", "refinement", "retro"];
export const CEREMONY_LABEL = "ceremony";
export const kindLabel = (kind) => `${CEREMONY_LABEL}:${kind}`;
const MAX_TITLE = 256; // GitHub's limit for an issue title
/** `<kind>: <YYYY-MM-DD> <title>`; the date is UTC, from the injected clock. Throws on a title GitHub would refuse or that hides text. */
export const titleFor = (kind, title, nowMs) => {
  if (typeof title !== "string" || title.trim() === "" || /\p{Cc}/u.test(title)) throw new TypeError("title must be a non-empty string with no control characters");
  const full = `${kind}: ${new Date(nowMs).toISOString().slice(0, 10)} ${title}`;
  if (full.length > MAX_TITLE) throw new TypeError(`the issue title is over GitHub's ${MAX_TITLE} characters`);
  return full;
};
export const checkKind = (kind) => {
  if (!CEREMONY_KINDS.includes(kind)) throw new TypeError(`ceremony kind ${JSON.stringify(kind)} must be one of ${CEREMONY_KINDS.join(", ")}`);
};
