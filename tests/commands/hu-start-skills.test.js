// KJC-TSK-1065 step 2: the host session (Claude Code orchestrating, kj governing)
// is where most work happens. Starting an HU says which skills apply to it and
// where to read them, from the HU's own text, as the coder prompt would get them.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { huCommand } from "../../src/commands/hu.js";

let dir;
const seen = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-hu-skills-"));
  seen.length = 0;
  vi.spyOn(console, "log").mockImplementation((l) => seen.push(String(l)));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

const skills = vi.fn(async ({ task }) => ({ skills: /frontend/i.test(task) ? [{ name: "frontend-ui-engineering", path: "/k/frontend-ui-engineering/SKILL.md", catalog: true }] : [], dropped: [] }));
const hu = (action, args, flags = {}) => huCommand({ config: { projectDir: dir }, action, args, flags, deps: { who: "ana", skills } });

// KJC-BUG-0517: the card kj hu start reads carries its `ref`, so the lane named after it is reused.
it("hu start reuses the lane named after the ref the shared board's row carries", async () => {
  const row = { short_id: "HU-9", title: "x", status: "pending", claimed_by: null, ref: "KJC-BUG-0517" };
  const manager = { isId: () => true, list: async () => [row], claim: async () => row, update: async () => row, move: async () => row };
  const lanes = async () => [{ slug: "KJC-BUG-0517-x", branch: "fix/KJC-BUG-0517-x", path: "/repo/.kj/worktrees/KJC-BUG-0517-x" }];
  const deps = { who: "ana", manager, lanes, boardConfig: async () => ({ backend: "github", repo: "o/r" }), pinGhIdentity: () => {} };
  const out = await huCommand({ config: { projectDir: dir }, action: "start", args: ["HU-9"], flags: { json: true }, deps });
  expect(out).toMatchObject({ reused: true, branch: "fix/KJC-BUG-0517-x" });
});

describe("starting an HU names its skills", () => {
  it("moving to running prints the skills that apply and where to read them, from the HU's text", async () => {
    await hu("add", ["Responsive frontend login form"], { id: "T-1" });
    await hu("move", ["T-1", "running"]);
    expect(skills).toHaveBeenCalledWith(expect.objectContaining({ role: "coder", task: expect.stringMatching(/Responsive frontend login form/), projectDir: dir }));
    expect(seen.join("\n")).toMatch(/skills for T-1.*\n- frontend-ui-engineering: read \/k\/frontend-ui-engineering\/SKILL\.md/i);
  });

  it("no skill applies: nothing is printed about skills; other moves never ask", async () => {
    await hu("add", ["Rename a variable"], { id: "T-2" });
    await hu("move", ["T-2", "running"]);
    expect(seen.join("\n")).not.toMatch(/skills for/i);
    skills.mockClear();
    await hu("move", ["T-2", "done"]);
    expect(skills).not.toHaveBeenCalled();
  });
});
