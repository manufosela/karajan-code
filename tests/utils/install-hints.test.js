import { describe, it, expect, beforeEach } from "vitest";
import { getInstallHint, appliesToStack, gitInstallPlan, resetPackageManagerCache } from "../../src/utils/install-hints.js";

// KJC-TSK v2.18 — platform-aware install hints for external audit tools.

describe("getInstallHint — manager prioritization", () => {
  beforeEach(() => { resetPackageManagerCache(); });

  it("prefers pipx > brew > pip for semgrep", async () => {
    const hint = await getInstallHint("semgrep", { pipx: true, brew: true, pip: true });
    expect(hint.command).toBe("pipx install semgrep");
    expect(hint.manager).toBe("pipx");
  });

  it("falls back to brew when pipx absent", async () => {
    const hint = await getInstallHint("semgrep", { pipx: false, brew: true, pip: true });
    expect(hint.command).toBe("brew install semgrep");
    expect(hint.manager).toBe("brew");
  });

  it("falls back to pip when only pip available", async () => {
    const hint = await getInstallHint("semgrep", { pipx: false, brew: false, pip: true });
    expect(hint.command).toBe("pip install semgrep");
  });

  it("prefers go install for osv-scanner, targeting the cmd/ subpackage (KJC-BUG-0105)", async () => {
    const hint = await getInstallHint("osv-scanner", { go: true, brew: true });
    // The module root has no main package: installing
    // github.com/google/osv-scanner@latest resolves the module but fails
    // with "does not contain package". The binary lives in /v2/cmd/.
    expect(hint.command).toBe("go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest");
    expect(hint.manager).toBe("go");
  });

  it("uses brew for osv-scanner when go missing", async () => {
    const hint = await getInstallHint("osv-scanner", { go: false, brew: true });
    expect(hint.command).toBe("brew install osv-scanner");
  });

  it("uses npm for lighthouse always", async () => {
    const hint = await getInstallHint("lighthouse", { npm: true });
    expect(hint.command).toBe("npm install -g lighthouse");
  });

  it("returns null manager + fallback command when nothing matches", async () => {
    const hint = await getInstallHint("semgrep", { pipx: false, brew: false, pip: false });
    expect(hint.manager).toBeNull();
    // The hint still offers a command for the user to consider.
    expect(hint.command).toBe("pipx install semgrep");
  });

  // KJC-BUG-0120 (issue #1256): the no-match fallback must be distro-aware —
  // PEP 668 makes the generic pip/pipx bootstrap fail on Debian/Ubuntu.
  it("suggests the apt pipx route on Debian when no runnable manager matches", async () => {
    const hint = await getInstallHint("semgrep", { pipx: false, brew: false, pip: false, apt: true });
    expect(hint.manager).toBeNull(); // display-only: sudo never auto-runs
    expect(hint.command).toBe("sudo apt update && sudo apt install -y pipx && pipx install semgrep");
  });

  it("suggests the dnf pipx route on Fedora when no runnable manager matches", async () => {
    const hint = await getInstallHint("semgrep", { pipx: false, brew: false, pip: false, dnf: true });
    expect(hint.manager).toBeNull();
    expect(hint.command).toMatch(/^sudo dnf install -y pipx/);
  });

  it("a runnable manager (pipx) still wins over the distro fallback", async () => {
    const hint = await getInstallHint("semgrep", { pipx: true, apt: true });
    expect(hint.manager).toBe("pipx");
    expect(hint.command).toBe("pipx install semgrep");
  });

  it("always includes the manual URL", async () => {
    const hint = await getInstallHint("semgrep", { pipx: true });
    expect(hint.manualUrl).toMatch(/semgrep\.dev/);
  });

  it("returns command:null for an unknown tool", async () => {
    const hint = await getInstallHint("nonexistent-tool", { brew: true });
    expect(hint.command).toBeNull();
    expect(hint.manager).toBeNull();
  });
});

describe("appliesToStack — stack gating", () => {
  it("lighthouse applies to frontend stacks", () => {
    expect(appliesToStack("lighthouse", { isFrontend: true })).toBe(true);
    expect(appliesToStack("lighthouse", { isFullstack: true })).toBe(true);
  });

  it("lighthouse does NOT apply to backend-only stacks", () => {
    expect(appliesToStack("lighthouse", { isBackend: true })).toBe(false);
  });

  it("lighthouse does NOT apply to null/empty stack", () => {
    expect(appliesToStack("lighthouse", null)).toBe(false);
    expect(appliesToStack("lighthouse", {})).toBe(false);
  });

  it("non-frontend tools (semgrep, osv) always apply", () => {
    expect(appliesToStack("semgrep", null)).toBe(true);
    expect(appliesToStack("osv-scanner", { isBackend: true })).toBe(true);
    expect(appliesToStack("docker", {})).toBe(true);
  });
});

describe("gitInstallPlan — package-manager selection", () => {
  it("prefers brew (user-level, no sudo) on macOS", () => {
    const plan = gitInstallPlan({ brew: true, apt: true });
    expect(plan.command).toBe("brew install git");
    expect(plan.manager).toBe("brew");
    expect(plan.needsSudo).toBe(false);
  });

  it("uses apt with sudo when brew is absent", () => {
    const plan = gitInstallPlan({ brew: false, apt: true });
    expect(plan.command).toBe("sudo apt-get install -y git");
    expect(plan.manager).toBe("apt");
    expect(plan.needsSudo).toBe(true);
  });

  it("uses dnf with sudo when only dnf is available", () => {
    const plan = gitInstallPlan({ dnf: true });
    expect(plan.command).toBe("sudo dnf install -y git");
    expect(plan.needsSudo).toBe(true);
  });

  it("uses choco/scoop on Windows (no sudo)", () => {
    expect(gitInstallPlan({ choco: true }).command).toBe("choco install git -y");
    expect(gitInstallPlan({ choco: true }).needsSudo).toBe(false);
    expect(gitInstallPlan({ scoop: true }).command).toBe("scoop install git");
  });

  it("returns a manual plan with URL when no manager matches", () => {
    const plan = gitInstallPlan({});
    expect(plan.command).toBeNull();
    expect(plan.manager).toBeNull();
    expect(plan.manualUrl).toMatch(/git-scm\.com/);
  });

  it("always includes the manual URL", () => {
    expect(gitInstallPlan({ brew: true }).manualUrl).toMatch(/git-scm\.com/);
  });
});
