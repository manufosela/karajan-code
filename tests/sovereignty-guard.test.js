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

  // KJC-BUG-0250 (#1897, #1892): a run is active while its lock is held by a live
  // process, not while run.log was written recently.
  describe("checkActiveSession", () => {
    const tmpDir = path.join(process.cwd(), ".kj-test-sovereignty");
    const kjDir = path.join(tmpDir, ".kj");
    const logPath = path.join(kjDir, "run.log");
    const lockPath = path.join(kjDir, "run.lock");

    beforeEach(() => {
      fs.mkdirSync(kjDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("is active while a live process holds the run lock", () => {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      const result = checkActiveSession(tmpDir);
      expect(result.active).toBe(true);
      expect(result.message).toContain("already running");
    });

    it("a fresh run.log without a lock is not a running pipeline (a failed run released it)", () => {
      fs.writeFileSync(logPath, "[preflight] init:failed");
      expect(checkActiveSession(tmpDir).active).toBe(false);
    });

    it("a lock whose process is gone, or unreadable, is stale", () => {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 2 ** 22 + 12345 }));
      expect(checkActiveSession(tmpDir).active).toBe(false);
      fs.writeFileSync(lockPath, "garbage");
      expect(checkActiveSession(tmpDir).active).toBe(false);
    });

    it("createRunLog takes the lock and close() releases it", async () => {
      const { createRunLog } = await import("../src/utils/run-log.js");
      const runLog = createRunLog(tmpDir);
      expect(checkActiveSession(tmpDir).active).toBe(true);
      runLog.close();
      expect(checkActiveSession(tmpDir).active).toBe(false);
      expect(fs.existsSync(logPath)).toBe(true);
    });

    it("a second run while one holds the lock does not own it, nor truncate its log, nor release it", async () => {
      const { createRunLog } = await import("../src/utils/run-log.js");
      const first = createRunLog(tmpDir);
      first.logText("first run working");
      const second = createRunLog(tmpDir);
      expect(first.owned).toBe(true);
      expect(second.owned).toBe(false);
      expect(fs.readFileSync(logPath, "utf8")).toContain("first run working");
      second.close();
      expect(checkActiveSession(tmpDir).active).toBe(true);
      first.close();
      expect(checkActiveSession(tmpDir).active).toBe(false);
    });

    it("concurrent processes racing for a stale lock: exactly one owns it", async () => {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 2 ** 22 + 12345, token: "old" }));
      const { spawn } = await import("node:child_process");
      const runLogUrl = new URL("../src/utils/run-log.js", import.meta.url).href;
      // Each racer reports whether it owns the lock and stays alive, holding it, until all have answered.
      const script = `import(${JSON.stringify(runLogUrl)}).then(({ createRunLog }) => { const r = createRunLog(${JSON.stringify(tmpDir)}); console.log(r.owned); setTimeout(() => {}, 1500); });`;
      const racers = Array.from({ length: 6 }, () => new Promise((done) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script]);
        let out = "";
        child.stdout.on("data", (d) => { out += d; });
        child.on("close", () => done(out.trim()));
      }));
      const answers = await Promise.all(racers);
      expect(answers.filter((a) => a === "true")).toHaveLength(1);
      expect(answers.filter((a) => a === "false")).toHaveLength(5);
    });

    it("a stale lock is taken over", async () => {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 2 ** 22 + 12345, token: "old" }));
      const { createRunLog } = await import("../src/utils/run-log.js");
      const run = createRunLog(tmpDir);
      expect(run.owned).toBe(true);
      run.close();
      expect(fs.existsSync(lockPath)).toBe(false);
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
      fs.writeFileSync(path.join(kjDir, "run.lock"), JSON.stringify({ pid: process.pid }));
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
