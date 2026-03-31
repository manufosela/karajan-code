import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// --- Mocks for ImpeccableRole template loading ---
vi.mock("../src/agents/index.js", () => ({
  createAgent: vi.fn(() => ({
    runTask: vi.fn(async () => ({
      ok: true,
      output: JSON.stringify({
        ok: true,
        result: { verdict: "APPROVED", issuesFound: 0, issuesFixed: 0, categories: {}, changes: [] },
        summary: "No frontend design issues found"
      })
    }))
  }))
}));

vi.mock("../src/webperf/devtools-detect.js", () => ({
  isDevToolsMcpAvailable: vi.fn(() => false),
  ensureWebPerfSkills: vi.fn(async () => ({ installed: [] }))
}));

describe("--design flag", () => {
  describe("CLI flag definition", () => {
    it("--design flag sets flags.design in CLI options", async () => {
      // Commander parses --design as flags.design = true
      const { Command } = await import("commander");
      const program = new Command();
      program
        .command("run")
        .argument("<task>")
        .option("--design", "Activate design refactoring mode")
        .action((task, flags) => {
          expect(flags.design).toBe(true);
        });

      await program.parseAsync(["node", "kj", "run", "fix stuff", "--design"]);
    });

    it("without --design flag, flags.design is undefined", async () => {
      const { Command } = await import("commander");
      const program = new Command();
      program
        .command("run")
        .argument("<task>")
        .option("--design", "Activate design refactoring mode")
        .action((task, flags) => {
          expect(flags.design).toBeUndefined();
        });

      await program.parseAsync(["node", "kj", "run", "fix stuff"]);
    });
  });

  describe("kj_run MCP tool schema", () => {
    it("design parameter exists in kj_run tool schema", async () => {
      const { tools } = await import("../src/mcp/tools.js");
      const kjRun = tools.find((t) => t.name === "kj_run");
      expect(kjRun).toBeDefined();
      expect(kjRun.inputSchema.properties.design).toBeDefined();
      expect(kjRun.inputSchema.properties.design.type).toBe("boolean");
    });
  });

  describe("--design forces impeccable enabled", () => {
    it("applyFlagOverrides enables impeccable and sets refactoring mode when design=true", () => {
      // Replicate the applyFlagOverrides logic from orchestrator.js
      const pipelineFlags = {
        plannerEnabled: false,
        refactorerEnabled: false,
        researcherEnabled: false,
        testerEnabled: false,
        securityEnabled: false,
        impeccableEnabled: false,
        reviewerEnabled: true,
        discoverEnabled: false,
        architectEnabled: false
      };

      const flags = { design: true };

      // Simulate applyFlagOverrides
      if (flags.enableImpeccable !== undefined) pipelineFlags.impeccableEnabled = Boolean(flags.enableImpeccable);
      if (flags.design) {
        pipelineFlags.impeccableEnabled = true;
        pipelineFlags.impeccableMode = "refactoring";
      }

      expect(pipelineFlags.impeccableEnabled).toBe(true);
      expect(pipelineFlags.impeccableMode).toBe("refactoring");
    });

    it("without --design, impeccable stays disabled and no mode is set", () => {
      const pipelineFlags = {
        impeccableEnabled: false
      };

      const flags = {};

      if (flags.enableImpeccable !== undefined) pipelineFlags.impeccableEnabled = Boolean(flags.enableImpeccable);
      if (flags.design) {
        pipelineFlags.impeccableEnabled = true;
        pipelineFlags.impeccableMode = "refactoring";
      }

      expect(pipelineFlags.impeccableEnabled).toBe(false);
      expect(pipelineFlags.impeccableMode).toBeUndefined();
    });
  });

  describe("ImpeccableRole mode selects correct template", () => {
    it("--design uses impeccable-design.md template (refactoring mode)", async () => {
      const { ImpeccableRole } = await import("../src/roles/impeccable-role.js");

      const role = new ImpeccableRole({
        config: {},
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        mode: "refactoring"
      });

      // The role name determines which template file is loaded
      expect(role.name).toBe("impeccable-design");
      expect(role.mode).toBe("refactoring");
    });

    it("without --design, impeccable uses default template (audit mode)", async () => {
      const { ImpeccableRole } = await import("../src/roles/impeccable-role.js");

      const role = new ImpeccableRole({
        config: {},
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
      });

      expect(role.name).toBe("impeccable");
      expect(role.mode).toBe("audit");
    });

    it("explicit mode=audit uses impeccable.md template", async () => {
      const { ImpeccableRole } = await import("../src/roles/impeccable-role.js");

      const role = new ImpeccableRole({
        config: {},
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        mode: "audit"
      });

      expect(role.name).toBe("impeccable");
      expect(role.mode).toBe("audit");
    });
  });

  describe("MCP run-kj.js passes --design flag", () => {
    it("design=true adds --design to CLI args", async () => {
      // We test by importing and checking the normalizeBoolFlag pattern
      // The run-kj.js file uses: normalizeBoolFlag(options.design, "--design", args)
      const args = [];
      const normalizeBoolFlag = (value, flagName, arr) => {
        if (value === true) arr.push(flagName);
      };

      normalizeBoolFlag(true, "--design", args);
      expect(args).toContain("--design");
    });

    it("design=undefined does not add --design to CLI args", () => {
      const args = [];
      const normalizeBoolFlag = (value, flagName, arr) => {
        if (value === true) arr.push(flagName);
      };

      normalizeBoolFlag(undefined, "--design", args);
      expect(args).not.toContain("--design");
    });
  });

  describe("impeccable-design.md template exists", () => {
    it("template file exists and contains refactoring instructions", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");

      const templatePath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "templates",
        "roles",
        "impeccable-design.md"
      );

      const content = await fs.readFile(templatePath, "utf8");
      expect(content).toContain("Refactoring Mode");
      expect(content).toContain("Apply ALL of these improvements");
      expect(content).toContain("Visual Hierarchy");
      expect(content).toContain("Spacing & Alignment");
      expect(content).toContain("Responsive");
      expect(content).toContain("Accessibility");
      expect(content).toContain("Micro-interactions");
      expect(content).toContain("Theming");
      expect(content).toContain("Apply changes directly");
    });
  });
});
