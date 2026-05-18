import { describe, it, expect, beforeEach } from "vitest";
import { getInstallHint, appliesToStack, resetPackageManagerCache } from "../../src/utils/install-hints.js";

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

  it("prefers go install for osv-scanner", async () => {
    const hint = await getInstallHint("osv-scanner", { go: true, brew: true });
    expect(hint.command).toMatch(/go install.*osv-scanner/);
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
