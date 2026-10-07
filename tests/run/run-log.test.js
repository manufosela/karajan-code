import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRunLog, readRunLog } from "../../src/utils/run-log.js";

describe("run-log", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-runlog-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createRunLog", () => {
    it("creates .kj directory and run.log file", () => {
      const log = createRunLog(tmpDir);
      log.close();
      expect(fs.existsSync(path.join(tmpDir, ".kj", "run.log"))).toBe(true);
    });

    it("writes events to log file", () => {
      const log = createRunLog(tmpDir);
      log.logEvent({ type: "coder:start", stage: "coder", message: "Coder started" });
      log.logText("[kj_run] finished");
      log.close();

      const content = fs.readFileSync(path.join(tmpDir, ".kj", "run.log"), "utf8");
      expect(content).toContain("Coder started");
      expect(content).toContain("[kj_run] finished");
    });
  });

  describe("readRunLog", () => {
    it("returns error when no log exists", () => {
      const result = readRunLog(path.join(tmpDir, "nonexistent"));
      expect(result.ok).toBe(false);
      expect(result.error).toContain("No active run log");
    });

    it("returns last N lines", () => {
      const log = createRunLog(tmpDir);
      for (let i = 0; i < 10; i++) {
        log.logText(`line ${i}`);
      }
      log.close();

      const result = readRunLog(tmpDir, 3);
      expect(result.ok).toBe(true);
      expect(result.lines).toHaveLength(3);
      expect(result.totalLines).toBe(11); // 1 header + 10 lines
    });

    it("includes parsed status", () => {
      const result = readRunLog(tmpDir);
      // no log exists yet
      expect(result.ok).toBe(false);
    });
  });

  describe("parseRunStatus (via readRunLog)", () => {
    it("detects running state from kj_run started while the run's process holds the lock", () => {
      const log = createRunLog(tmpDir);
      log.logText('[kj_run] started — task="Fix bug"');

      const result = readRunLog(tmpDir);
      log.close();
      expect(result.status.isRunning).toBe(true);
      expect(result.status.currentStage).toBe("kj_run");
    });

    // KJC-BUG-0288 (#1982): a run that died with its host session never logs
    // "finished"; the lock names its process, and a dead process is not a run.
    it("a run whose process is gone is not running, and says so", () => {
      const log = createRunLog(tmpDir);
      log.logText('[kj_run] started — task="Fix bug"');
      log.close();
      fs.writeFileSync(path.join(tmpDir, ".kj", "run.lock"), JSON.stringify({ pid: 2_147_483_000, startedAt: "x", token: "t" }));

      const result = readRunLog(tmpDir);
      expect(result.status.isRunning).toBe(false);
      expect(result.status.died).toBe(true);
      expect(result.status.note).toMatch(/process is gone/);
      // No lock at all: nobody holds the run either.
      fs.rmSync(path.join(tmpDir, ".kj", "run.lock"));
      expect(readRunLog(tmpDir).status.isRunning).toBe(false);
    });

    it("detects finished state", () => {
      const log = createRunLog(tmpDir);
      log.logText('[kj_run] started — task="Fix bug"');
      log.logText("[kj_run] finished — ok=true");
      log.close();

      const result = readRunLog(tmpDir);
      expect(result.status.isRunning).toBe(false);
    });

    it("detects current stage from stage:start events", () => {
      const log = createRunLog(tmpDir);
      log.logText('[kj_run] started — task="t"');
      log.logEvent({ type: "coder:start", stage: "coder", message: "Coder running" });
      log.close();

      const result = readRunLog(tmpDir);
      expect(result.status.currentStage).toBe("coder");
    });

    it("detects current agent", () => {
      const log = createRunLog(tmpDir);
      log.logEvent({ type: "coder:start", stage: "coder", message: "running", detail: { provider: "claude" } });
      log.close();

      const result = readRunLog(tmpDir);
      expect(result.status.currentAgent).toBe("claude");
    });

    it("detects iteration number", () => {
      const log = createRunLog(tmpDir);
      log.logText("[iteration:start] Iteration 3/5");
      log.close();

      const result = readRunLog(tmpDir);
      expect(result.status.iteration).toBe(3);
    });

    it("collects recent errors (max 3)", () => {
      const log = createRunLog(tmpDir);
      log.logText("[sonar:fail] Quality gate FAILED");
      log.logText("[coder:fail] Coder error 1");
      log.logText("[reviewer:fail] Reviewer error");
      log.logText("[coder:fail] Coder error 2");
      log.close();

      const result = readRunLog(tmpDir);
      expect(result.status.errors).toHaveLength(3);
      expect(result.status.errors[0]).toContain("Coder error 1");
    });

    it("detects standby state", () => {
      const log = createRunLog(tmpDir);
      log.logText('[kj_run] started — task="t"');
      log.logEvent({ type: "coder:standby", stage: "coder", message: "Rate limited, waiting..." });
      log.close();

      const result = readRunLog(tmpDir);
      expect(result.status.currentStage).toBe("standby");
    });

    it("detects kj_code started", () => {
      const log = createRunLog(tmpDir);
      log.logText("[kj_code] started — provider=claude");

      const result = readRunLog(tmpDir);
      log.close();
      expect(result.status.isRunning).toBe(true);
      expect(result.status.currentStage).toBe("kj_code");
    });

    it("detects kj_plan started", () => {
      const log = createRunLog(tmpDir);
      log.logText("[kj_plan] started — provider=codex");

      const result = readRunLog(tmpDir);
      log.close();
      expect(result.status.isRunning).toBe(true);
      expect(result.status.currentStage).toBe("kj_plan");
    });
  });
});
