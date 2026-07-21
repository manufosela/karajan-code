// KJC-TSK-0659 — stop-on-sudo: pending-user-action classification + block.
import { describe, it, expect } from "vitest";
import { collectPending, renderPendingBlock, osCommandsFor, PENDING_EXIT_CODE } from "../../src/utils/pending-user-action.js";

describe("collectPending", () => {
  it("keeps manual/failed/needs-user, drops installed and skipped", () => {
    const results = [
      { tool: "semgrep", action: "installed" },
      { tool: "docker", action: "manual", manualUrl: "https://docs.docker.com" },
      { tool: "git", action: "failed", error: "exit 100" },
      { tool: "lighthouse", action: "skipped" },
      { tool: "sonar", action: "needs-user" },
    ];
    expect(collectPending(results, { tty: true }).map((r) => r.tool)).toEqual(["docker", "git", "sonar"]);
  });

  it("treats a non-TTY auto-decline as pending (nobody actually declined)", () => {
    const results = [{ tool: "docker", action: "declined", command: "sudo apt-get install -y docker.io" }];
    expect(collectPending(results, { tty: false, yes: false })).toHaveLength(1);
    // A real interactive decline is the user's own decision — not pending.
    expect(collectPending(results, { tty: true, yes: false })).toHaveLength(0);
    // With --yes the decline was explicit input upstream — not reclassified.
    expect(collectPending(results, { tty: false, yes: true })).toHaveLength(0);
  });
});

describe("renderPendingBlock", () => {
  it("emits exact per-OS commands for the detected platform and orders agents to wait", () => {
    const block = renderPendingBlock(
      [{ tool: "docker", action: "manual", reason: "platform installer required" }],
      { platform: "linux" },
    );
    expect(block).toMatch(/PENDING USER ACTION/);
    expect(block).toMatch(/sudo apt-get install -y docker\.io/);
    expect(block).toMatch(/sudo dnf install -y docker/);
    expect(block).toMatch(/STOP here/);
    expect(block).toMatch(new RegExp(`Exit code ${PENDING_EXIT_CODE}`));
    expect(block).not.toMatch(/winget/); // only THIS OS's commands
  });

  it("prefers the exact command the run already computed over the generic table", () => {
    const block = renderPendingBlock(
      [{ tool: "git", action: "declined", command: "sudo dnf install -y git" }],
      { platform: "linux" },
    );
    expect(block).toMatch(/sudo dnf install -y git/);
    expect(block).not.toMatch(/apt-get install -y git/);
  });

  it("a FAILED install prefers the curated per-OS route over re-suggesting the broken command", () => {
    const block = renderPendingBlock(
      [{ tool: "semgrep", action: "failed", command: "pip install semgrep", error: "externally-managed-environment" }],
      { platform: "linux" },
    );
    expect(block).toMatch(/sudo apt update && sudo apt install -y pipx/);
    expect(block).not.toMatch(/ {6}pip install semgrep/); // the broken route is not the instruction
    expect(block).toMatch(/externally-managed-environment/); // the error still explains WHY
  });

  it("falls back to the manual URL when no command is known", () => {
    const block = renderPendingBlock([{ tool: "weird", action: "manual", manualUrl: "https://x.dev" }], { platform: "linux" });
    expect(block).toMatch(/see https:\/\/x\.dev/);
  });
});

describe("osCommandsFor", () => {
  it("covers ollama per OS (reused by kj env install when the RAG cannot index)", () => {
    expect(osCommandsFor("ollama", "darwin").join(" ")).toMatch(/brew install ollama/);
    expect(osCommandsFor("ollama", "linux").join(" ")).toMatch(/ollama\.com\/install\.sh/);
    expect(osCommandsFor("ollama", "win32").join(" ")).toMatch(/winget/);
    expect(osCommandsFor("nope", "linux")).toEqual([]);
  });
});
