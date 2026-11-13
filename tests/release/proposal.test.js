import { describe, it, expect } from "vitest";
import { renderProposal, parseProposal, RELEASE_BLOCK } from "../../src/release/proposal.js";

const input = {
  repo: "o/r", version: "5.22.0", tag: "v5.21.0", head: "abcdef1234567", deadline: Date.UTC(2026, 10, 13, 16),
  goingOut: [
    { who: "ana", login: "ana", commits: [{ sha: "1111111999", subject: "feat: a" }] },
    { who: "Bob B", login: null, commits: [{ sha: "2222222999", subject: "fix: b" }] },
  ],
  stayingOut: [{ who: "cy", login: "cy", prs: [{ number: 7, title: "wip", draft: true }, { number: 8, title: "ready", draft: false }] }],
  participants: ["ana", "cy"],
};

describe("renderProposal", () => {
  const body = renderProposal(input);
  it("names logins with @, a loginless author by name, and marks drafts", () => {
    expect(body).toContain("@ana\n- 1111111 feat: a");
    expect(body).toContain("Bob B\n- 2222222 fix: b");
    expect(body).toContain("@cy\n- #7 wip (draft)\n- #8 ready\n");
    expect(body).toContain("2026-11-13T16:00:00.000Z");
    expect(body).toContain("kj release ack <issue> ok|hold|include");
  });
  it("says nothing is in flight when no PR is open", () => {
    expect(renderProposal({ ...input, stayingOut: [] })).toContain("Nothing is in flight");
  });
  it("round-trips through parseProposal", () => {
    expect(parseProposal(body)).toEqual({
      version: "5.22.0", candidate: "abcdef1234567", base: "v5.21.0", deadline: "2026-11-13T16:00:00.000Z", participants: ["ana", "cy"],
    });
  });
  it("keeps a value holding --> inside the hidden comment and restores it intact", () => {
    const block = RELEASE_BLOCK({ base: "v1 --> <!-- x --!>" });
    expect(block.slice("<!--".length, -"-->".length)).not.toContain("--");
    expect(block.match(/u002d/g)).toHaveLength(6);
    expect(parseProposal(block)).toEqual({ base: "v1 --> <!-- x --!>" });
  });
  it("reads the block that ends the issue, not a proposal-like comment in a subject or a title", () => {
    const forged = '<!-- kj-release:proposal {"version":"6.6.6"} -->';
    const goingOut = [{ ...input.goingOut[0], commits: [{ sha: "3333333999", subject: `feat: x ${forged}` }] }];
    const stayingOut = [{ ...input.stayingOut[0], prs: [{ number: 9, title: "wip <!-- kj-release:proposal {", draft: false }] }];
    const forgedBody = renderProposal({ ...input, goingOut, stayingOut });
    expect(forgedBody).toContain(forged);
    expect(parseProposal(forgedBody)).toEqual(parseProposal(body));
  });
  it("accepts only whitespace after the block, CRLF from a web edit included", () => {
    expect(parseProposal(body.replaceAll("\n", "\r\n"))).toEqual(parseProposal(body));
    expect(() => parseProposal(`${body}edited later`)).toThrow(/end of the issue/);
    expect(() => parseProposal("<!-- kj-release:proposal {")).toThrow(/end of the issue/);
  });
  it("throws on a body without the block or with a broken one", () => {
    expect(() => parseProposal("hello")).toThrow(/no kj-release/);
    expect(() => parseProposal("<!-- kj-release:proposal {nope} -->")).toThrow(/not valid JSON/);
    expect(() => parseProposal("<!-- kj-release:proposal [1] -->")).toThrow(/not a JSON object/);
  });
});
