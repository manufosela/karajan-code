import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isDevToolsMcpAvailable,
  ensureWebPerfSkills,
  WEBPERF_SKILLS
} from "../src/webperf/devtools-detect.js";

// Mock the openskills-client module
vi.mock("../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn(),
  installSkill: vi.fn(),
  listSkills: vi.fn()
}));

import {
  isOpenSkillsAvailable,
  installSkill,
  listSkills
} from "../src/skills/openskills-client.js";

describe("webperf/devtools-detect", () => {
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  describe("isDevToolsMcpAvailable", () => {
    it("returns false by default (no config)", () => {
      expect(isDevToolsMcpAvailable({})).toBe(false);
    });

    it("returns false when webperf.devtools_mcp is false", () => {
      expect(isDevToolsMcpAvailable({ webperf: { devtools_mcp: false } })).toBe(false);
    });

    it("returns true when config.webperf.devtools_mcp is true", () => {
      expect(isDevToolsMcpAvailable({ webperf: { devtools_mcp: true } })).toBe(true);
    });

    it("returns false when config is null/undefined", () => {
      expect(isDevToolsMcpAvailable(null)).toBe(false);
      expect(isDevToolsMcpAvailable(undefined)).toBe(false);
    });
  });

  describe("ensureWebPerfSkills", () => {
    it("installs skills when not present", async () => {
      isOpenSkillsAvailable.mockResolvedValue(true);
      listSkills.mockResolvedValue({ ok: true, skills: [] });
      installSkill.mockResolvedValue({ ok: true, name: "mock-skill" });

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.installed).toEqual(WEBPERF_SKILLS);
      expect(result.alreadyInstalled).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(installSkill).toHaveBeenCalledTimes(WEBPERF_SKILLS.length);
      for (const skill of WEBPERF_SKILLS) {
        expect(installSkill).toHaveBeenCalledWith(skill, { projectDir: "/tmp/project" });
      }
    });

    it("skips when already installed", async () => {
      isOpenSkillsAvailable.mockResolvedValue(true);
      listSkills.mockResolvedValue({
        ok: true,
        skills: WEBPERF_SKILLS.map(name => ({ name }))
      });

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.installed).toEqual([]);
      expect(result.alreadyInstalled).toEqual(WEBPERF_SKILLS);
      expect(result.skipped).toEqual([]);
      expect(installSkill).not.toHaveBeenCalled();
    });

    it("handles OpenSkills unavailable gracefully", async () => {
      isOpenSkillsAvailable.mockResolvedValue(false);

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.installed).toEqual([]);
      expect(result.alreadyInstalled).toEqual([]);
      expect(result.skipped).toEqual(WEBPERF_SKILLS);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("OpenSkills CLI not available")
      );
      expect(installSkill).not.toHaveBeenCalled();
      expect(listSkills).not.toHaveBeenCalled();
    });

    it("handles partial installation (some already installed)", async () => {
      isOpenSkillsAvailable.mockResolvedValue(true);
      listSkills.mockResolvedValue({
        ok: true,
        skills: [{ name: "webperf" }]
      });
      installSkill.mockResolvedValue({ ok: true, name: "mock" });

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.alreadyInstalled).toEqual(["webperf"]);
      expect(result.installed).toEqual(["webperf-core-web-vitals", "webperf-loading"]);
      expect(installSkill).toHaveBeenCalledTimes(2);
    });

    it("reports skipped skills when install fails", async () => {
      isOpenSkillsAvailable.mockResolvedValue(true);
      listSkills.mockResolvedValue({ ok: true, skills: [] });
      installSkill.mockResolvedValue({ ok: false, error: "not found" });

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.installed).toEqual([]);
      expect(result.skipped).toEqual(WEBPERF_SKILLS);
      expect(logger.warn).toHaveBeenCalledTimes(WEBPERF_SKILLS.length);
    });

    it("works without logger", async () => {
      isOpenSkillsAvailable.mockResolvedValue(false);

      const result = await ensureWebPerfSkills("/tmp/project");

      expect(result.skipped).toEqual(WEBPERF_SKILLS);
    });
  });
});
