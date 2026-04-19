import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn(),
  installSkill: vi.fn(),
  removeSkill: vi.fn(),
}));

vi.mock("../../src/skills/skill-loader.js", () => ({
  loadAvailableSkills: vi.fn().mockResolvedValue([]),
}));

describe("skills/fallback — graceful degradation when openskills CLI is missing", () => {
  let autoInstallSkills, client;

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ autoInstallSkills } = await import("../../src/skills/skill-detector.js"));
    client = await import("../../src/skills/openskills-client.js");
    const loader = await import("../../src/skills/skill-loader.js");
    loader.loadAvailableSkills.mockResolvedValue([]);
  });

  it("returns osAvailable:false and wouldHaveUsed when CLI is missing", async () => {
    client.isOpenSkillsAvailable.mockResolvedValue(false);

    const result = await autoInstallSkills(["java", "pytest-patterns"], "/proj");

    expect(result.osAvailable).toBe(false);
    expect(result.wouldHaveUsed).toEqual(["java", "pytest-patterns"]);
    expect(result.installed).toEqual([]);
    expect(client.installSkill).not.toHaveBeenCalled();
  });

  it("does NOT report already-installed skills as wouldHaveUsed", async () => {
    client.isOpenSkillsAvailable.mockResolvedValue(false);
    const loader = await import("../../src/skills/skill-loader.js");
    loader.loadAvailableSkills.mockResolvedValue([{ name: "java", content: "" }]);

    const result = await autoInstallSkills(["java", "pytest-patterns"], "/proj");

    expect(result.osAvailable).toBe(false);
    expect(result.wouldHaveUsed).toEqual(["pytest-patterns"]);
  });

  it("returns osAvailable:true and installs normally when CLI is present", async () => {
    client.isOpenSkillsAvailable.mockResolvedValue(true);
    client.installSkill.mockResolvedValue({ ok: true, name: "java" });

    const result = await autoInstallSkills(["java"], "/proj");

    expect(result.osAvailable).toBe(true);
    expect(result.wouldHaveUsed).toEqual([]);
    expect(result.installed).toEqual(["java"]);
    expect(client.installSkill).toHaveBeenCalledTimes(1);
  });

  it("does nothing and returns osAvailable:true when neededSkills is empty", async () => {
    const result = await autoInstallSkills([], "/proj");

    expect(result.installed).toEqual([]);
    expect(result.wouldHaveUsed).toEqual([]);
    expect(result.osAvailable).toBe(true);
    expect(client.isOpenSkillsAvailable).not.toHaveBeenCalled();
  });
});
