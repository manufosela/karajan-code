import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isDevToolsMcpAvailable,
  ensureWebPerfSkills,
  WEBPERF_SKILLS
} from "../src/webperf/devtools-detect.js";

vi.mock("../src/skills/openskills-client.js", () => ({
  isOpenSkillsAvailable: vi.fn(),
  installSkill: vi.fn(),
  listSkills: vi.fn()
}));

import {
  isOpenSkillsAvailable,
  listSkills
} from "../src/skills/openskills-client.js";

describe("webperf/devtools-detect", () => {
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  });

  describe("isDevToolsMcpAvailable", () => {
    it("returns true when config flag is true", () => {
      expect(isDevToolsMcpAvailable({ webperf: { devtools_mcp: true } })).toBe(true);
    });

    it("returns false when config flag is false", () => {
      expect(isDevToolsMcpAvailable({ webperf: { devtools_mcp: false } })).toBe(false);
    });

    it("returns false when config is null/undefined", () => {
      expect(isDevToolsMcpAvailable(null)).toBe(false);
      expect(isDevToolsMcpAvailable(undefined)).toBe(false);
    });
  });

  describe("ensureWebPerfSkills", () => {
    it("reports already installed skills", async () => {
      isOpenSkillsAvailable.mockResolvedValue(true);
      listSkills.mockResolvedValue({
        ok: true,
        skills: WEBPERF_SKILLS.map(name => ({ name }))
      });

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.alreadyInstalled).toEqual(WEBPERF_SKILLS);
      expect(result.skipped).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("available"));
    });

    it("reports missing skills as skipped (no auto-install)", async () => {
      isOpenSkillsAvailable.mockResolvedValue(true);
      listSkills.mockResolvedValue({ ok: true, skills: [] });

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.installed).toEqual([]);
      expect(result.skipped).toEqual(WEBPERF_SKILLS);
    });

    it("handles OpenSkills unavailable gracefully", async () => {
      isOpenSkillsAvailable.mockResolvedValue(false);

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.skipped).toEqual(WEBPERF_SKILLS);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("OpenSkills CLI not available")
      );
    });

    it("handles partial availability", async () => {
      isOpenSkillsAvailable.mockResolvedValue(true);
      listSkills.mockResolvedValue({
        ok: true,
        skills: [{ name: WEBPERF_SKILLS[0] }]
      });

      const result = await ensureWebPerfSkills("/tmp/project", logger);

      expect(result.alreadyInstalled).toEqual([WEBPERF_SKILLS[0]]);
      expect(result.skipped).toEqual(WEBPERF_SKILLS.slice(1));
    });

    it("works without logger", async () => {
      isOpenSkillsAvailable.mockResolvedValue(false);

      const result = await ensureWebPerfSkills("/tmp/project");

      expect(result.skipped).toEqual(WEBPERF_SKILLS);
    });
  });
});
