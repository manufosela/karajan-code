// HU-3796: the kj-link codec reads untrusted text; hostile input may only ever throw a LinkBlockError, and fast.
import { describe, expect, it } from "vitest";
import { LINK_FIELDS, LINK_TYPES, LinkBlockError, SUPPORTED_MAJOR, formatLinkBlock, parseLinkBlock } from "../../src/link/block.js";

const base = { v: 1, type: "status", id: "101", reply_to: null, context: "HU-3796", to: "all", speaker: "agent" };
const msg = (over = {}) => ({ conclusion: "Working on it", block: { ...base, ...over } });
const rows = ["v: 1", "type: status", "id: 101", "reply_to: null", "context: HU-3796", "to: all", "speaker: agent"];
const fence = (r) => `Working on it\n\n\`\`\`kj-link\n${r.join("\n")}\n\`\`\``;
const swap = (key, value) => rows.map((l) => (l.startsWith(`${key}:`) ? `${key}: ${value}` : l));
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LinkBlockError);
    return e.code;
  }
  throw new Error("expected a LinkBlockError");
};
const parseCode = (text) => code(() => parseLinkBlock(text));

describe("round trip, version, types", () => {
  it("formats in a fixed order and parses back to itself, also with CRLF", () => {
    expect(formatLinkBlock(msg())).toBe(fence(rows));
    expect(parseLinkBlock(fence(rows))).toEqual(msg());
    expect(parseLinkBlock(fence(rows).replaceAll("\n", "\r\n"))).toEqual(msg());
    expect([LINK_FIELDS.length, LINK_TYPES.length, SUPPORTED_MAJOR]).toEqual([7, 11, 1]);
  });
  it.each(LINK_TYPES)("type %s round-trips", (type) => {
    const m = msg({ type, reply_to: "77", to: "jorge-d", speaker: "person", context: "owner/repo#9" });
    expect(parseLinkBlock(formatLinkBlock(m))).toEqual(m);
  });
  it("refuses a higher major and a bad v, ignores unknown fields", () => {
    expect(parseCode(fence(swap("v", 2)))).toBe("unsupported_version");
    expect(parseLinkBlock(fence([...rows, "future_field: x", "constructor: y"]))).toEqual(msg());
    for (const v of ["0", "-1", "1.5", "null", "01", "1e6", "1 0"]) expect(parseCode(fence(swap("v", v)))).toBe("bad_field");
  });
});
describe("validation", () => {
  it("rejects an unknown type", () => expect(parseCode(fence(swap("type", "shout")))).toBe("unknown_type"));
  it.each(["id", "context", "to", "speaker", "type", "v", "reply_to"])("requires %s", (key) => {
    expect(parseCode(fence(rows.filter((l) => !l.startsWith(`${key}:`))))).toBe("missing_field");
  });
  it.each(["accept", "decline"])("%s must reply to a message", (type) => {
    expect(code(() => formatLinkBlock(msg({ type })))).toBe("missing_field");
  });
  it.each([
    ["id", "a b"], ["id", "null"], ["id", "x".repeat(65)], ["reply_to", "a/b"], ["context", "a b"],
    ["to", "-bad"], ["to", "bad-"], ["to", "a_b"], ["to", "x".repeat(40)], ["speaker", "robot"],
  ])("rejects %s: %s", (key, value) => {
    expect(code(() => formatLinkBlock(msg({ [key]: value })))).toBe("bad_field");
    expect(parseCode(fence(swap(key, value)))).toBe("bad_field");
  });
  it.each(["id", "reply_to", "context", "to", "speaker"])("format refuses a trailing newline in %s", (key) => {
    expect(code(() => formatLinkBlock(msg({ [key]: `${base[key] ?? "5"}\n` })))).toBe("bad_field");
  });
  it("refuses duplicate and malformed lines, and never reads the conclusion as a field", () => {
    expect(parseCode(fence([...rows, "to: x"]))).toBe("duplicate_field");
    for (const bad of ["no separator", "Bad Key: x", "empty:"]) expect(parseCode(fence([...rows, bad]))).toBe("malformed_line");
    expect(parseLinkBlock(formatLinkBlock(msg()).replace("Working on it", "type: decision")).block.type).toBe("status");
  });
  it("refuses a conclusion that is not one clean line", () => {
    for (const [conclusion, want] of [["a\nb", "bad_conclusion"], ["", "bad_conclusion"], ["```kj-link", "bad_conclusion"], ["x".repeat(501), "line_too_long"], ["a\u0007", "control_char"]]) {
      expect(code(() => formatLinkBlock({ ...msg(), conclusion }))).toBe(want);
    }
  });
});
describe("hostile input", () => {
  it("refuses a non-string body, no block, no conclusion, stray text, two blocks, an open fence", () => {
    const inner = rows.join("\n");
    for (const input of [null, undefined, 42, {}]) expect(parseCode(input)).toBe("bad_input");
    expect(parseCode("just a comment")).toBe("no_block");
    expect(parseCode("a\n\n```js\nx\n```")).toBe("no_block");
    expect(parseCode(`\`\`\`kj-link\n${inner}\n\`\`\``)).toBe("no_conclusion");
    expect(parseCode(`a\nmore\n\`\`\`kj-link\n${inner}\n\`\`\``)).toBe("text_outside_block");
    expect(parseCode(`${fence(rows)}\ntrailing`)).toBe("text_outside_block");
    expect(parseCode(`${fence(rows)}\n\n${fence(rows)}`)).toBe("multiple_blocks");
    expect(parseCode(`a\n\n\`\`\`kj-link\n${inner}`)).toBe("unterminated_fence");
  });
  it("refuses a block over 4 KB and a line over 500 characters", () => {
    const many = Array.from({ length: 200 }, (_, i) => `k${i}: ${"x".repeat(30)}`);
    expect(parseCode(fence([...rows, ...many]))).toBe("block_too_large");
    expect(parseCode(fence([...rows, `note: ${"x".repeat(500)}`]))).toBe("line_too_long");
  });
  it.each(["\u0000", "\u0007", "\u001b", "\u007f", "\t", "\r"])("refuses control character %j", (c) => {
    expect(parseCode(formatLinkBlock(msg()).replace("agent", `ag${c}ent`))).toBe("control_char");
    expect(parseCode(formatLinkBlock(msg()).replace("Working", `Wo${c}rking`))).toBe("control_char");
  });
  it("refuses a fence injected in a value or opened inside the block", () => {
    for (const bad of ["note: a ``` b", "```js", "  ```", "~~~"]) expect(parseCode(fence([...rows, bad]))).toBe("fence_injection");
  });
  it("fails fast on huge or pathological bodies", () => {
    const started = Date.now();
    for (const huge of ["a".repeat(5e6), `a\n\n\`\`\`kj-link\n${"k: v\n".repeat(1e6)}`, "`".repeat(2e6)]) expect(parseCode(huge)).toBe("body_too_large");
    for (const t of ["`".repeat(60_000), `a\n${"```kj-link\n".repeat(4000)}`, `a\n\n\`\`\`kj-link\n${"x".repeat(3900)}\n\`\`\``]) expect(() => parseLinkBlock(t)).toThrow(LinkBlockError);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
