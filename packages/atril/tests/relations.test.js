// HU-0013 (ADR 0021, decision 9): enrichment proposes uses / delegates /
// related from how the body names other artifacts of the scan.
import { describe, expect, it } from "vitest";
import { discoverRelations } from "../src/enrich.js";

const artifact = (kind, name, body = "", declared = {}) => ({ kind, name, body, uses: [], delegates: [], related: [], ...declared });
const STORE = [
  artifact("skill", "tdd"),
  artifact("skill", "review"),
  artifact("command", "deploy"),
  artifact("agent", "tester"),
];
const discover = (body, declared) => discoverRelations(artifact("command", "ship", body, declared), STORE);

describe("discoverRelations", () => {
  it.each([
    ["a /command", "Then run /deploy.", { related: ["command:deploy"] }],
    ["skill:name", "Load skill:tdd first", { uses: ["skill:tdd"] }],
    ["plugin:name", "Apply agent-skills:review here", { uses: ["skill:review"] }],
    ["subagent_type", 'Task({ subagent_type: "tester" })', { delegates: ["agent:tester"] }],
    ["@agent", "Hand it to @tester.", { delegates: ["agent:tester"] }],
    ["a link to a file", "See [it](../commands/deploy.md) and skills/tdd/SKILL.md", { uses: ["skill:tdd"], related: ["command:deploy"] }],
    ["an agent's path", "Its prompt is agents/tester.md", { related: ["agent:tester"] }],
    ["use the X skill", "Use the review skill on the diff", { uses: ["skill:review"] }],
  ])("detects %s", (_form, body, expected) => {
    expect(discover(body)).toEqual(expected);
  });

  it("keeps the author's relations and adds no discovered duplicate", () => {
    expect(discover("Use the tdd skill, then /deploy", { uses: ["skill:tdd"] })).toEqual({ related: ["command:deploy"] });
  });

  it("proposes nothing for unknown artifacts, emails or the artifact itself", () => {
    expect(discover("Run /nope, skill:ghost, @nobody, me@tester.dev and /ship")).toEqual({});
  });
});
