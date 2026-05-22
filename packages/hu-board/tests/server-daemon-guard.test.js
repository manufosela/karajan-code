import { describe, expect, it, afterEach } from "vitest";
import { isDaemonEntryPoint } from "../src/server.js";

// Regression for the "silent board start failure": the legacy guard
// `import.meta.url === file://${process.argv[1]}` wrongly returned
// false on Windows (backslashes), linked/global installs (symlinks)
// and paths with spaces, so main() never ran and the daemon exited 0
// without writing a single line to hu-board.log. The launcher now
// passes KJ_BOARD_DAEMON=1, which isDaemonEntryPoint trusts directly.

describe("isDaemonEntryPoint — board daemon guard", () => {
  afterEach(() => {
    delete process.env.KJ_BOARD_DAEMON;
  });

  it("returns true when the launcher sets KJ_BOARD_DAEMON=1", () => {
    process.env.KJ_BOARD_DAEMON = "1";
    expect(isDaemonEntryPoint()).toBe(true);
  });

  it("returns false on a plain import (no flag, argv is the test runner)", () => {
    delete process.env.KJ_BOARD_DAEMON;
    // import.meta.url of server.js never equals the vitest runner
    // path, so without the flag the daemon would NOT auto-start here.
    expect(isDaemonEntryPoint()).toBe(false);
  });
});
