// KJC-TSK-1271 (#2753): a repo with no atril store still gets reviewer skills for
// its stack, from the reviewer's own store or a catalog, installed in a temporary
// store outside the reviewed repo and removed afterwards.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { thirdPartySkills } from "../../src/review/third-party-skills.js";

const stack = { languages: ["typescript"], frameworks: ["astro"] };
const skill = (name) => ({ name, kind: "skill", source: "user", path: `/x/${name}/SKILL.md`, content: `# ${name}`, as: "inline" });
const fakeAtril = (over = {}) => ({
  resolve: vi.fn(() => ({ block: [], left: [], reason: "no artifact matches" })),
  search: vi.fn(() => []),
  installFromCatalog: vi.fn(),
  catalogSync: vi.fn(() => []),
  ...over,
});

describe("thirdPartySkills", () => {
  it("asks for nothing when no stack was detected", async () => {
    const atril = fakeAtril();
    const res = await thirdPartySkills({ stack: { languages: [], frameworks: [] }, max: 3, atril });
    expect(res).toMatchObject({ skills: [], installed: [], reason: expect.stringMatching(/no stack/) });
    expect(atril.resolve).not.toHaveBeenCalled();
  });

  it("uses an installed skill that fits the stack and the reviewer role, and installs nothing", async () => {
    const atril = fakeAtril({ resolve: vi.fn(() => ({ block: [skill("astro-review")], left: [] })) });
    const res = await thirdPartySkills({ stack, max: 3, atril });
    expect(atril.resolve).toHaveBeenCalledWith(expect.objectContaining({ role: "reviewer", task: "astro typescript code review", budget: { maxArtifacts: 3 } }));
    expect(res.skills.map((s) => s.name)).toEqual(["astro-review"]);
    expect(atril.installFromCatalog).not.toHaveBeenCalled();
    res.cleanup();
  });

  it("installs the best catalog skill in a temporary store outside the repo, resolves again and cleans up", async () => {
    let installedInto = null;
    const atril = fakeAtril({
      resolve: vi.fn().mockReturnValueOnce({ block: [], left: [], reason: "none" }).mockReturnValueOnce({ block: [skill("astro")], left: [{ name: "ts" }] }),
      search: vi.fn(() => [{ name: "astro", kind: "skill", installed: false, catalog: "atril:recommended" }]),
      installFromCatalog: vi.fn((ref, opts) => { installedInto = opts.projectDir; }),
    });
    const res = await thirdPartySkills({ stack, max: 2, atril });
    expect(atril.installFromCatalog).toHaveBeenCalledWith("skill:astro", expect.objectContaining({ root: ".atril" }));
    expect(installedInto.startsWith(os.tmpdir())).toBe(true);
    expect(res).toMatchObject({ installed: ["astro"], dropped: ["ts"] });
    expect(res.skills.map((s) => s.name)).toEqual(["astro"]);
    expect(fs.existsSync(installedInto)).toBe(true);
    res.cleanup();
    expect(fs.existsSync(installedInto)).toBe(false);
  });

  it("lists the given catalogs in the temporary store and fetches them", async () => {
    const atril = fakeAtril({ catalogSync: vi.fn((opts) => {
      const config = JSON.parse(fs.readFileSync(path.join(opts.projectDir, ".atril", "atril.json"), "utf8"));
      expect(config).toEqual({ catalogs: ["/abs/team.json"] });
      return [];
    }) });
    const res = await thirdPartySkills({ stack, max: 3, catalogs: ["/abs/team.json"], atril });
    expect(atril.catalogSync).toHaveBeenCalledOnce();
    res.cleanup();
  });

  it("refuses a relative catalog, which would resolve against the temporary folder", async () => {
    await expect(thirdPartySkills({ stack, max: 3, catalogs: ["catalogs/team.json"], atril: fakeAtril() })).rejects.toThrow(/absolute/);
  });
});
