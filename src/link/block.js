/**
 * HU-3796: the kj-link block of an agent message (ADR 0043, spec section 5):
 * a conclusion line and ONE fenced block of `key: value` lines. Pure functions
 * over untrusted text; every failure is a LinkBlockError with a `code`.
 * Rejected: a YAML/JSON block read with a library; a general parser on text any
 * commenter writes opens surface (anchors, tags, nesting) a seven-field format never needs.
 */
export const SUPPORTED_MAJOR = 1; // D1, the owner's: a higher major is refused.
export const LINK_FIELDS = ["v", "type", "id", "reply_to", "context", "to", "speaker"]; // D2: `to` and `speaker` are proposals.
export const LINK_TYPES = [
  "assign", "accept", "decline", "review_request", "review_result", "blocker",
  "blocker_help", "blocker_cleared", "status", "decision_needed", "decision",
];
const REPLY_TYPES = new Set(["accept", "decline"]);
const [MAX_BODY, MAX_BLOCK, MAX_LINE] = [65_536, 4096, 500]; // the body is GitHub's own comment limit
const OPEN = "```kj-link";
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/; // everything but "\n"
const KEY = /^[a-z][a-z0-9_]{0,31}$/;
const SHAPES = {
  id: /^[A-Za-z0-9_-]{1,64}$/,
  context: /^[A-Za-z0-9#_./-]{1,100}$/,
  to: /^(?:all|[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)$/,
  speaker: /^(?:agent|person)$/,
};

export class LinkBlockError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new LinkBlockError(code, message);
};
const fenceLike = (line) => /^\s*(?:```|~~~)/.test(line);
const checkText = (text, what) => {
  if (CONTROL.test(text)) fail("control_char", `${what} has a control character`);
  if (text.length > MAX_LINE) fail("line_too_long", `${what} is over ${MAX_LINE} characters`);
};

function validate(raw) {
  if (raw === null || typeof raw !== "object") fail("bad_input", "the block must be an object");
  for (const key of LINK_FIELDS) if (raw[key] === undefined) fail("missing_field", `missing field: ${key}`);
  const v = String(raw.v);
  if (!/^[1-9]\d{0,5}$/.test(v)) fail("bad_field", "v must be a positive integer");
  if (Number(v) > SUPPORTED_MAJOR) fail("unsupported_version", `v ${v} is newer than the supported major ${SUPPORTED_MAJOR}`);
  if (!LINK_TYPES.includes(raw.type)) fail("unknown_type", `unknown type: ${String(raw.type).slice(0, 40)}`);
  const out = { v: Number(v), type: raw.type };
  for (const key of ["id", "reply_to", "context", "to", "speaker"]) {
    const value = raw[key];
    if (key === "reply_to" && value === null) {
      if (REPLY_TYPES.has(raw.type)) fail("missing_field", `${raw.type} must reply to a message`);
    } else if (typeof value !== "string" || value === "null" || value.includes("\n") || !SHAPES[key === "reply_to" ? "id" : key].test(value)) {
      fail("bad_field", `bad value for ${key}`);
    }
    out[key] = value;
  }
  return out;
}

/** Parses a comment body into `{ conclusion, block }`, or throws a LinkBlockError. */
export function parseLinkBlock(body) {
  if (typeof body !== "string") fail("bad_input", "the comment body must be a string");
  if (body.length > MAX_BODY) fail("body_too_large", `the comment is over ${MAX_BODY} characters`);
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  for (const line of lines) checkText(line, "a line");
  const opens = lines.flatMap((l, i) => (l === OPEN ? [i] : []));
  if (opens.length > 1) fail("multiple_blocks", "more than one kj-link block");
  if (opens.length === 0) fail("no_block", "no kj-link block");
  const [open] = opens;
  const conclusion = lines[0].trim();
  if (open === 0 || !conclusion) fail("no_conclusion", "the first line must be the conclusion");
  if (lines.slice(1, open).some((l) => l.trim())) fail("text_outside_block", "text between the conclusion and the block");
  const close = lines.indexOf("```", open + 1);
  const inner = lines.slice(open + 1, close < 0 ? undefined : close);
  if (inner.some((l) => fenceLike(l) || l.includes("```"))) fail("fence_injection", "a fence inside the block");
  if (close < 0) fail("unterminated_fence", "the block is not closed");
  if (lines.slice(close + 1).some((l) => l.trim())) fail("text_outside_block", "text after the block");
  if (inner.join("\n").length > MAX_BLOCK) fail("block_too_large", `the block is over ${MAX_BLOCK} characters`);
  const raw = Object.create(null); // keys come from the comment: `toString` or `__proto__` must be plain keys
  for (const line of inner.filter((l) => l.trim())) {
    const at = line.indexOf(":");
    const key = line.slice(0, at);
    const value = line.slice(at + 1).trim();
    if (at < 1 || !KEY.test(key) || !value) fail("malformed_line", "a block line must be `key: value`");
    if (key in raw) fail("duplicate_field", `duplicate field: ${key}`);
    raw[key] = value === "null" ? null : value;
  }
  return { conclusion, block: validate(raw) };
}

/** The exact comment text for a message; parse(format(m)) equals m. */
export function formatLinkBlock({ conclusion, block } = {}) {
  const fields = validate(block);
  if (typeof conclusion !== "string" || !conclusion || conclusion !== conclusion.trim() || conclusion.includes("\n") || fenceLike(conclusion)) {
    fail("bad_conclusion", "the conclusion must be one non-empty line, trimmed, and not a fence");
  }
  checkText(conclusion, "the conclusion");
  const rows = LINK_FIELDS.map((key) => `${key}: ${fields[key] === null ? "null" : fields[key]}`);
  return `${conclusion}\n\n${OPEN}\n${rows.join("\n")}\n\`\`\``;
}
