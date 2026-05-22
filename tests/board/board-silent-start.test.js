import { describe, expect, it, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { isDaemonEntryPoint } from "../../packages/hu-board/src/server.js";
import { waitForEarlyExit } from "../../src/commands/board.js";

// Regression for the "silent board start failure": `kj board start`
// wrote its log line, spawned server.js, and server.js exited 0
// without a trace because the legacy `import.meta.url === file://...`
// guard wrongly returned false (Windows backslashes, linked installs
// resolving symlinks, paths with spaces). main() never ran and the
// launcher reported a phantom success. Two mechanisms fix it:
//   1. server.js trusts an explicit KJ_BOARD_DAEMON=1 flag.
//   2. board.js watches the child for an early exit before reporting ok.

describe("isDaemonEntryPoint (server.js daemon guard)", () => {
  afterEach(() => {
    delete process.env.KJ_BOARD_DAEMON;
  });

  it("returns true when the launcher sets KJ_BOARD_DAEMON=1", () => {
    process.env.KJ_BOARD_DAEMON = "1";
    expect(isDaemonEntryPoint()).toBe(true);
  });

  it("returns false on a plain import (no flag, argv is the test runner)", () => {
    delete process.env.KJ_BOARD_DAEMON;
    // import.meta.url of server.js never equals the vitest runner path,
    // so without the flag the daemon would NOT auto-start here.
    expect(isDaemonEntryPoint()).toBe(false);
  });
});

describe("waitForEarlyExit (board.js early-death detector)", () => {
  afterEach(() => {
    delete process.env.KJ_BOARD_START_WINDOW_MS;
  });

  it("reports an actionable error when the daemon exits with a code", async () => {
    const child = new EventEmitter();
    const pending = waitForEarlyExit(child, "/tmp/hu-board.log");
    child.emit("exit", 1, null);
    const failure = await pending;
    expect(failure).toMatch(/died on startup \(exit code 1\)/);
    expect(failure).toContain("/tmp/hu-board.log");
  });

  it("reports the signal when the daemon is killed (e.g. native crash)", async () => {
    const child = new EventEmitter();
    const pending = waitForEarlyExit(child, "/tmp/x.log");
    child.emit("exit", null, "SIGSEGV");
    expect(await pending).toMatch(/died on startup \(signal SIGSEGV\)/);
  });

  it("resolves null when the daemon survives the startup window", async () => {
    process.env.KJ_BOARD_START_WINDOW_MS = "10";
    const child = new EventEmitter();
    expect(await waitForEarlyExit(child, "/tmp/x.log")).toBeNull();
  });
});
