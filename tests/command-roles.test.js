import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../src/roles/base-role.js", () => ({
  resolveRoleMdPath: vi.fn(),
  loadFirstExisting: vi.fn()
}));

vi.mock("../src/utils/fs.js", () => ({
  exists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  resolveRole: vi.fn(),
  getConfigPath: vi.fn(),
  loadConfig: vi.fn(),
  applyRunOverrides: vi.fn(),
  validateConfig: vi.fn()
}));

describe("roles command", () => {
  let listRoles, showRole, rolesCommand, PIPELINE_ROLES, REVIEW_VARIANTS;
  let resolveRole;
  let resolveRoleMdPath, loadFirstExisting;
  let exists;

  const baseConfig = {
    coder: "codex",
    reviewer: "claude",
    roles: {
      coder: { provider: "codex", model: null },
      reviewer: { provider: "claude", model: null },
      planner: { provider: null, model: null }
    },
    pipeline: {
      planner: { enabled: false },
      refactorer: { enabled: false },
      researcher: { enabled: false },
      tester: { enabled: false },
      security: { enabled: false },
      triage: { enabled: true },
      solomon: { enabled: false }
    },
    sonarqube: { enabled: true }
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    ({ resolveRole } = await import("../src/config.js"));
    ({ resolveRoleMdPath, loadFirstExisting } = await import("../src/roles/base-role.js"));
    ({ exists } = await import("../src/utils/fs.js"));
    ({ listRoles, showRole, rolesCommand, PIPELINE_ROLES, REVIEW_VARIANTS } = await import("../src/commands/roles.js"));
  });

  describe("PIPELINE_ROLES", () => {
    it("contains all expected roles", () => {
      const names = PIPELINE_ROLES.map((r) => r.name);
      expect(names).toContain("coder");
      expect(names).toContain("reviewer");
      expect(names).toContain("triage");
      expect(names).toContain("planner");
      expect(names).toContain("sonar");
      expect(names).toContain("solomon");
      expect(names).toContain("commiter");
      expect(names).toContain("tester");
      expect(names).toContain("security");
      expect(names).toContain("researcher");
      expect(names).toContain("refactorer");
    });
  });

  describe("REVIEW_VARIANTS", () => {
    it("contains strict, relaxed, paranoid variants", () => {
      expect(REVIEW_VARIANTS).toContain("reviewer-strict");
      expect(REVIEW_VARIANTS).toContain("reviewer-relaxed");
      expect(REVIEW_VARIANTS).toContain("reviewer-paranoid");
    });
  });

  describe("listRoles", () => {
    it("returns role list with provider and enabled status", () => {
      resolveRole.mockImplementation((_config, role) => {
        if (role === "coder") return { provider: "codex", model: null };
        if (role === "reviewer") return { provider: "claude", model: null };
        return { provider: null, model: null };
      });

      const roles = listRoles(baseConfig);
      expect(roles).toHaveLength(PIPELINE_ROLES.length);

      const coder = roles.find((r) => r.name === "coder");
      expect(coder.provider).toBe("codex");
      expect(coder.enabled).toBe(true);

      const triage = roles.find((r) => r.name === "triage");
      expect(triage.enabled).toBe(true);

      const planner = roles.find((r) => r.name === "planner");
      expect(planner.enabled).toBe(false);
    });

    it("shows sonar enabled based on sonarqube config", () => {
      resolveRole.mockReturnValue({ provider: null, model: null });
      const roles = listRoles(baseConfig);
      const sonar = roles.find((r) => r.name === "sonar");
      expect(sonar.enabled).toBe(true);

      const disabledConfig = { ...baseConfig, sonarqube: { enabled: false } };
      const roles2 = listRoles(disabledConfig);
      const sonar2 = roles2.find((r) => r.name === "sonar");
      expect(sonar2.enabled).toBe(false);
    });
  });

  describe("showRole", () => {
    it("returns content and source for built-in role", async () => {
      resolveRoleMdPath.mockReturnValue(["/project/.karajan/roles/coder.md", "/home/.karajan/roles/coder.md", "/built-in/coder.md"]);
      exists.mockResolvedValue(false);
      loadFirstExisting.mockResolvedValue("# Coder Rules\nWrite code.");

      const result = await showRole("coder", baseConfig);
      expect(result.found).toBe(true);
      expect(result.content).toContain("Coder Rules");
      expect(result.source).toBe("built-in");
      expect(result.customPath).toBeNull();
    });

    it("returns custom source when project override exists", async () => {
      resolveRoleMdPath.mockReturnValue(["/project/.karajan/roles/coder.md", "/home/.karajan/roles/coder.md", "/built-in/coder.md"]);
      exists.mockResolvedValue(true);
      loadFirstExisting.mockResolvedValue("# Custom Coder");

      const result = await showRole("coder", baseConfig);
      expect(result.found).toBe(true);
      expect(result.source).toBe("custom");
      expect(result.customPath).toBe("/project/.karajan/roles/coder.md");
    });

    it("returns found=false when no template exists", async () => {
      resolveRoleMdPath.mockReturnValue(["/a.md", "/b.md"]);
      exists.mockResolvedValue(false);
      loadFirstExisting.mockResolvedValue(null);

      const result = await showRole("nonexistent", baseConfig);
      expect(result.found).toBe(false);
    });
  });

  describe("rolesCommand", () => {
    it("prints role list when subcommand is list", async () => {
      resolveRole.mockReturnValue({ provider: "codex", model: null });
      const logs = [];
      vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

      const result = await rolesCommand({ config: baseConfig, subcommand: "list" });
      expect(Array.isArray(result)).toBe(true);
      expect(logs.some((l) => l.includes("Role"))).toBe(true);
      expect(logs.some((l) => l.includes("coder"))).toBe(true);
      expect(logs.some((l) => l.includes('kj roles show'))).toBe(true);

      console.log.mockRestore();
    });

    it("prints role template when subcommand is show", async () => {
      resolveRoleMdPath.mockReturnValue(["/a.md", "/b.md", "/c.md"]);
      exists.mockResolvedValue(false);
      loadFirstExisting.mockResolvedValue("# Reviewer\nReview code carefully.");

      const logs = [];
      vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

      const result = await rolesCommand({ config: baseConfig, subcommand: "show", roleName: "reviewer" });
      expect(result.found).toBe(true);
      expect(logs.some((l) => l.includes("Reviewer"))).toBe(true);

      console.log.mockRestore();
    });

    it("shows not found message for unknown role", async () => {
      resolveRoleMdPath.mockReturnValue(["/a.md"]);
      exists.mockResolvedValue(false);
      loadFirstExisting.mockResolvedValue(null);

      const logs = [];
      vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args.join(" ")));

      const result = await rolesCommand({ config: baseConfig, subcommand: "show", roleName: "unknown" });
      expect(result.found).toBe(false);
      expect(logs.some((l) => l.includes("not found"))).toBe(true);

      console.log.mockRestore();
    });
  });
});
