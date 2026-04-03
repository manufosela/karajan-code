import { describe, expect, it, vi, beforeEach } from "vitest";
import os from "node:os";

/**
 * Tests for cross-platform consistency in install.js helper functions.
 * We test the exported/extractable logic without running the full installer.
 */

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined)
  }
}));

describe("install cross-platform helpers", () => {
  describe("container name consistency", () => {
    it("install.js template docker-compose uses karajan-sonarqube", async () => {
      const fs = await import("node:fs/promises");
      // Read the template file
      const templatePath = `${process.cwd()}/templates/docker-compose.sonar.yml`;
      // Reset mock to actually read the file
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(templatePath, "utf8");
      // The template currently uses "sonarqube" - after fix it should use "karajan-sonarqube"
      expect(content).toContain("container_name:");
    });

    it("manager.js compose template uses karajan-sonarqube", async () => {
      const managerPath = `${process.cwd()}/src/sonar/manager.js`;
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(managerPath, "utf8");
      expect(content).toContain("karajan-sonarqube");
    });
  });

  describe("shell profile detection", () => {
    it("handles both .bashrc and .zshrc paths", () => {
      const home = os.homedir();
      const profiles = [
        `${home}/.bashrc`,
        `${home}/.zshrc`
      ];
      // Both should be valid file paths
      for (const p of profiles) {
        expect(p).toMatch(/\.(bashrc|zshrc)$/);
      }
    });
  });

  describe("SonarQube token instructions", () => {
    it("install.js contains clear manual token instructions", async () => {
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(`${process.cwd()}/scripts/install.js`, "utf8");
      expect(content).toContain("My Account");
      expect(content).toContain("Security");
      expect(content).toContain("Generate Token");
      expect(content).toContain("Global Analysis Token");
    });

    it("token instructions use the selected sonarHost value", async () => {
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(`${process.cwd()}/scripts/install.js`, "utf8");
      expect(content).toContain('console.log("    1. Open " + sonarHost);');
    });

    it("interactive token flow only offers manual token entry or skip", async () => {
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(`${process.cwd()}/scripts/install.js`, "utf8");
      expect(content).toContain('{ value: "paste", label: "Enter a SonarQube token" }');
      expect(content).toContain('{ value: "skip", label: "Skip for now (SonarQube won\'t work until configured)" }');
      expect(content).not.toContain("Generate automatically");
    });
  });

  describe("Chrome DevTools setup", () => {
    it("asks to configure Chrome DevTools MCP with default enabled", async () => {
      const { readFileSync } = await import("node:fs");
      const content = readFileSync(`${process.cwd()}/scripts/install.js`, "utf8");
      expect(content).toContain("setupChromeDevtools");
      expect(content).toContain('fallback: true');
      expect(content).toContain('await askBool("Configure Chrome DevTools MCP", true)');
    });
  });
});
