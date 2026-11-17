// HU-4574: kj harden installs the guide an agent reads to work with Karajan, as a project skill.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_GUIDE, agentGuide } from "../../src/harden/agent-guide.js";

let project;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), "kj-agent-guide-")); });
afterEach(() => rmSync(project, { recursive: true, force: true }));

describe("agentGuide", () => {
  it("writes the skill once, leaves it unchanged after, and the dry run writes nothing", () => {
    expect(agentGuide(project, true)).toEqual([{ file: AGENT_GUIDE, action: "created" }]);
    expect(existsSync(join(project, AGENT_GUIDE))).toBe(false);
    expect(agentGuide(project)).toEqual([{ file: AGENT_GUIDE, action: "created" }]);
    expect(readFileSync(join(project, AGENT_GUIDE), "utf8")).toMatch(/^---\nname: working-with-karajan\n/);
    expect(agentGuide(project)).toEqual([{ file: AGENT_GUIDE, action: "unchanged" }]);
  });

  it("updates an older copy kj wrote, and leaves one written by hand", () => {
    const target = join(project, AGENT_GUIDE);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "---\nname: working-with-karajan\n---\n<!-- kj:managed:working-with-karajan -->\nold\n");
    expect(agentGuide(project)).toEqual([{ file: AGENT_GUIDE, action: "updated" }]);
    writeFileSync(target, "my own guide\n");
    expect(agentGuide(project)[0]).toMatchObject({ action: "skipped" });
    expect(readFileSync(target, "utf8")).toBe("my own guide\n");
  });
});
