import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateSovereignty, checkActiveSession } from "../src/mcp/sovereignty-guard.js";

describe("sovereignty-guard", () => {
  describe("validateSovereignty", () => {
    it("strips enableHuReviewer:false with warning", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        enableHuReviewer: false,
      });
      expect(params.enableHuReviewer).toBeUndefined();
      expect(warnings).toContain(
        "Pipeline decides hu-reviewer activation, ignoring override"
      );
    });

    it("keeps enableHuReviewer:true without warning", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        enableHuReviewer: true,
      });
      expect(params.enableHuReviewer).toBe(true);
      expect(warnings).toHaveLength(0);
    });

    it("strips enableTriage:false with warning", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        enableTriage: false,
      });
      expect(params.enableTriage).toBeUndefined();
      expect(warnings).toContain(
        "Triage is mandatory, ignoring override"
      );
    });

    it("keeps enableTriage:true without warning", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        enableTriage: true,
      });
      expect(params.enableTriage).toBe(true);
      expect(warnings).toHaveLength(0);
    });

    it("allows mode:paranoid through", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        mode: "paranoid",
      });
      expect(params.mode).toBe("paranoid");
      expect(warnings).toHaveLength(0);
    });

    it("allows methodology:standard through", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        methodology: "standard",
      });
      expect(params.methodology).toBe("standard");
      expect(warnings).toHaveLength(0);
    });

    it("clamps maxIterations:0 to 1", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        maxIterations: 0,
      });
      expect(params.maxIterations).toBe(1);
      expect(warnings.some((w) => w.includes("clamped to 1"))).toBe(true);
    });

    it("clamps maxIterations:100 to 10", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        maxIterations: 100,
      });
      expect(params.maxIterations).toBe(10);
      expect(warnings.some((w) => w.includes("clamped to 10"))).toBe(true);
    });

    it("keeps maxIterations:5 as-is", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        maxIterations: 5,
      });
      expect(params.maxIterations).toBe(5);
      expect(warnings).toHaveLength(0);
    });

    it("strips unknown parameters with warning", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        hackTheSystem: true,
        injectPayload: "evil",
      });
      expect(params.hackTheSystem).toBeUndefined();
      expect(params.injectPayload).toBeUndefined();
      expect(warnings).toContain('Unknown parameter "hackTheSystem" stripped');
      expect(warnings).toContain('Unknown parameter "injectPayload" stripped');
    });

    it("combines multiple violations", () => {
      const { params, warnings } = validateSovereignty({
        task: "do stuff",
        enableTriage: false,
        enableHuReviewer: false,
        maxIterations: 999,
        unknownFlag: true,
      });
      expect(params.enableTriage).toBeUndefined();
      expect(params.enableHuReviewer).toBeUndefined();
      expect(params.maxIterations).toBe(10);
      expect(params.unknownFlag).toBeUndefined();
      expect(warnings).toHaveLength(4);
    });
  });

  describe("checkActiveSession", () => {
    const tmpDir = path.join(process.cwd(), ".kj-test-sovereignty");
    const kjDir = path.join(tmpDir, ".kj");
    const logPath = path.join(kjDir, "run.log");

    beforeEach(() => {
      fs.mkdirSync(kjDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns active when run.log was modified recently", () => {
      fs.writeFileSync(logPath, "running...");
      // File was just written, so mtime is now — well within 60s
      const result = checkActiveSession(tmpDir);
      expect(result.active).toBe(true);
      expect(result.message).toContain("already running");
    });

    it("returns inactive when run.log is stale", () => {
      fs.writeFileSync(logPath, "done");
      // Backdate the file by 2 minutes
      const past = new Date(Date.now() - 120_000);
      fs.utimesSync(logPath, past, past);
      const result = checkActiveSession(tmpDir);
      expect(result.active).toBe(false);
    });

    it("returns inactive when run.log does not exist", () => {
      // No log file written
      fs.rmSync(logPath, { force: true });
      const result = checkActiveSession(tmpDir);
      expect(result.active).toBe(false);
    });

    it("returns inactive when projectDir is falsy", () => {
      const result = checkActiveSession(null);
      expect(result.active).toBe(false);
    });
  });

  describe("validateSovereignty with active session", () => {
    const tmpDir = path.join(process.cwd(), ".kj-test-sovereignty-session");
    const kjDir = path.join(tmpDir, ".kj");
    const logPath = path.join(kjDir, "run.log");

    beforeEach(() => {
      fs.mkdirSync(kjDir, { recursive: true });
      fs.writeFileSync(logPath, "running pipeline...");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns error when active session detected", () => {
      const result = validateSovereignty(
        { task: "do stuff" },
        { projectDir: tmpDir }
      );
      expect(result.error).toContain("already running");
    });
  });

  describe("validateSovereignty without active session", () => {
    it("allows execution when no projectDir is provided", () => {
      const result = validateSovereignty({ task: "do stuff" });
      expect(result.error).toBeUndefined();
      expect(result.params.task).toBe("do stuff");
    });

    it("allows execution when run.log does not exist", () => {
      const result = validateSovereignty(
        { task: "do stuff" },
        { projectDir: "/tmp/nonexistent-project-dir-12345" }
      );
      expect(result.error).toBeUndefined();
    });
  });
});
