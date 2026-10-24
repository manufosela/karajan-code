// KJC-TSK-1065: the skills kj picks for a role and a task reach the prompt. The
// project's own skills first, then the local addyosmani catalog by task and by
// role, up to 3; the rest are named. The maintainer's choices (2026-10-17).
import { describe, it, expect } from "vitest";
import { roleSkills, buildRoleSkillSection } from "../../src/skills/role-skills.js";

const catalog = ["frontend-ui-engineering", "incremental-implementation", "source-driven-development", "context-engineering", "debugging-and-error-recovery", "code-review-and-quality", "code-simplification", "security-and-hardening"];
const deps = (local = []) => ({
  loadLocal: async () => local,
  listCatalog: async () => catalog,
  loadCatalog: async (slugs) => slugs.map((slug) => ({ name: slug, content: `# ${slug}\nbody`, path: `/home/u/.karajan/agent-skills/skills/${slug}/SKILL.md` })),
});

describe("roleSkills", () => {
  it("a UI task puts the task's skill before the role's, up to 3, and names the rest", async () => {
    const r = await roleSkills({ role: "coder", task: "Build the responsive frontend login form", projectDir: "/p", deps: deps() });
    expect(r.skills.map((s) => s.name)).toEqual(["frontend-ui-engineering", "incremental-implementation", "source-driven-development"]);
    expect(r.dropped).toEqual(["context-engineering", "debugging-and-error-recovery"]);
    expect(r.skills[0]).toMatchObject({ catalog: true, path: expect.stringMatching(/frontend-ui-engineering\/SKILL\.md$/) });
  });

  it("the project's own skills come first", async () => {
    const r = await roleSkills({ role: "reviewer", task: "fix the auth flow", projectDir: "/p", deps: deps([{ name: "our-conventions", content: "x" }]) });
    expect(r.skills.map((s) => s.name)).toEqual(["our-conventions", "security-and-hardening", "code-review-and-quality"]);
    expect(r.skills[0].catalog).toBeUndefined();
  });

  it("no catalog on this machine: only the project's skills, nothing invented", async () => {
    const r = await roleSkills({ role: "coder", task: "frontend", projectDir: "/p", deps: { ...deps(), listCatalog: async () => [] } });
    expect(r).toEqual({ skills: [], dropped: [], limit: 3, source: "legacy" });
  });
});

describe("the coder prompt, end to end", () => {
  it("a UI task's coder prompt names the frontend skill of the local catalog with the path to read", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { getKarajanHome } = await import("../../src/utils/paths.js");
    const home = getKarajanHome(); // isolated to a tmp dir per worker under Vitest
    const skill = path.join(home, "agent-skills", "skills", "frontend-ui-engineering");
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: frontend-ui-engineering\n---\n# UI\n");
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "kj-skills-proj-"));
    try {
      const { buildCoderPrompt } = await import("../../src/prompts/coder.js");
      const prompt = await buildCoderPrompt({ task: "Build the responsive frontend login form", projectDir: project, provider: "claude" });
      expect(prompt).toContain(`frontend-ui-engineering: read ${path.join(skill, "SKILL.md")}`);
    } finally {
      fs.rmSync(skill, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});

describe("buildRoleSkillSection", () => {
  it("for claude a catalog skill is named with the path to read, never as already loaded", () => {
    const section = buildRoleSkillSection({ skills: [{ name: "frontend-ui-engineering", content: "c", path: "/k/frontend-ui-engineering/SKILL.md", catalog: true }], dropped: ["context-engineering"] }, { provider: "claude" });
    expect(section).toMatch(/frontend-ui-engineering: read \/k\/frontend-ui-engineering\/SKILL\.md/);
    expect(section).not.toMatch(/already loaded/);
    expect(section).toMatch(/Left out \(limit 3\): context-engineering/);
  });

  it("for other providers the content goes inline, and nothing to say is an empty section", () => {
    expect(buildRoleSkillSection({ skills: [{ name: "x", content: "# x body", catalog: true, path: "/p" }], dropped: [] }, { provider: "codex" })).toMatch(/### x\n# x body/);
    expect(buildRoleSkillSection({ skills: [], dropped: [] }, { provider: "codex" })).toBe("");
  });
});
