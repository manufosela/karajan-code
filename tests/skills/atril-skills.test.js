// KJC-TSK-1188 (ADR 0021, step 15a): the core asks atril for a role's skills
// exactly as a third party would: resolve() over the store under .karajan,
// bounded by skills.max_per_role. No store, no atril: the legacy path stays.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atrilRoleSkills, hasAtrilStore, ATRIL_ROOT } from "../../src/skills/atril-skills.js";
import { roleSkills, buildRoleSkillSection } from "../../src/skills/role-skills.js";

const skill = (dir, name, extra = "") => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} for the frontend login form\nkind: skill\n${extra}---\n# ${name}\n`);
};

const withStore = async (fn) => {
  const project = mkdtempSync(join(tmpdir(), "kj-atril-skills-"));
  const user = mkdtempSync(join(tmpdir(), "kj-atril-user-"));
  try {
    const skills = join(project, ATRIL_ROOT, "skills");
    skill(skills, "frontend-forms", "roles: [coder]\nuses: [skill:a11y]\n");
    skill(skills, "a11y", "roles: [coder]\n");
    skill(skills, "review-rules", "roles: [reviewer]\n");
    return await fn(project, user); // cleanup waits for an async callback
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(user, { recursive: true, force: true });
  }
};

describe("atrilRoleSkills", () => {
  it("resolves the task for the role from .karajan and names each artifact with its path", () => withStore(async (projectDir, userRoot) => {
    const r = await atrilRoleSkills({ role: "coder", task: "build the frontend login form", projectDir, max: 3, userRoot });
    expect(r.skills.map((s) => s.name)).toEqual(["a11y", "frontend-forms"]);
    expect(r.skills[0]).toMatchObject({ catalog: true, path: join(projectDir, ATRIL_ROOT, "skills", "a11y", "SKILL.md") });
    expect(r.dropped).toEqual([]);
  }));

  it("the budget cuts the block and names what was left out", () => withStore(async (projectDir, userRoot) => {
    const r = await atrilRoleSkills({ role: "coder", task: "build the frontend login form", projectDir, max: 1, userRoot });
    expect(r.skills.map((s) => s.name)).toEqual(["frontend-forms"]);
    expect(r.dropped).toEqual(["a11y"]);
  }));

  it("a role no artifact serves gets an empty block with the reason, never an invented skill", () => withStore(async (projectDir, userRoot) => {
    const r = await atrilRoleSkills({ role: "tester", task: "frontend login form", projectDir, max: 3, userRoot });
    expect(r.skills).toEqual([]);
    expect(r.reason).toMatch(/for role tester/);
  }));

  it("a command or an agent in the block is never passed off as a skill: it comes back apart", async () => {
    const block = [
      { name: "a11y", kind: "skill", path: "/s/a11y/SKILL.md", content: "c", as: "inline" },
      { name: "ship", kind: "command", path: "/c/ship.md", content: "c", as: "inline" },
      { name: "qa", kind: "agent", path: "/a/qa.md", content: "c", as: "subagent", block: [] },
    ];
    const r = await atrilRoleSkills({ role: "coder", task: "ship", projectDir: "/p", max: 3, resolveFn: () => ({ block, left: [] }) });
    expect(r.skills.map((s) => s.name)).toEqual(["a11y"]);
    expect(r.others).toEqual([{ name: "ship", kind: "command", path: "/c/ship.md" }, { name: "qa", kind: "agent", path: "/a/qa.md" }]);
  });

  it("hasAtrilStore: true with a skills directory under .karajan, false without", () => withStore((projectDir) => {
    expect(hasAtrilStore(projectDir)).toBe(true);
    expect(hasAtrilStore(join(projectDir, "nowhere"))).toBe(false);
  }));
});

describe("roleSkills prefers atril", () => {
  const legacy = { loadLocal: async () => [{ name: "ours", content: "x" }], listCatalog: async () => [], loadCatalog: async () => [] };

  it("with a store under .karajan the block comes from atril and the choice is logged once", async () => {
    const logs = [];
    const atril = ({ role, max }) => ({ skills: [{ name: `${role}-skill`, content: "c", path: "/p", catalog: true }], dropped: [], max });
    const deps = { ...legacy, hasAtril: () => true, atril };
    const logger = { info: (m) => logs.push(m) };
    const a = await roleSkills({ role: "coder", task: "t", projectDir: "/p", deps, logger });
    const b = await roleSkills({ role: "coder", task: "t", projectDir: "/p", deps, logger });
    expect(a.skills.map((s) => s.name)).toEqual(["coder-skill"]);
    expect(a.source).toBe("atril");
    expect(b.source).toBe("atril");
    expect(logs).toEqual([expect.stringMatching(/\[skills\] .*atril.*\.karajan/)]);
  });

  it("the project's skills.max_per_role is the budget atril gets, end to end", () => withStore(async (projectDir, userRoot) => {
    mkdirSync(join(projectDir, ".karajan"), { recursive: true });
    writeFileSync(join(projectDir, ".karajan", "kj.config.yml"), "skills:\n  max_per_role: 1\n");
    const before = process.env.ATRIL_USER_ROOT;
    process.env.ATRIL_USER_ROOT = userRoot; // the machine's ~/.atril stays out of the test
    let r;
    try {
      r = await roleSkills({ role: "coder", task: "build the frontend login form", projectDir, logger: { info() {} } });
    } finally {
      if (before === undefined) delete process.env.ATRIL_USER_ROOT; else process.env.ATRIL_USER_ROOT = before;
    }
    expect(r.source).toBe("atril");
    expect(r.skills.map((s) => s.name)).toEqual(["frontend-forms"]);
    expect(r.dropped).toEqual(["a11y"]);
    expect(buildRoleSkillSection(r, { provider: "claude" })).toContain("Left out (limit 1): a11y");
  }));

  it("without a store the legacy path answers and says so", async () => {
    const r = await roleSkills({ role: "coder", task: "t", projectDir: "/p", deps: { ...legacy, hasAtril: () => false } });
    expect(r.skills.map((s) => s.name)).toEqual(["ours"]);
    expect(r.source).toBe("legacy");
  });
});
