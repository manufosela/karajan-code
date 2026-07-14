import { describe, it, expect } from "vitest";
import { dockerInstallPlan } from "../../src/utils/docker-install.js";

// KJC-TSK-0609 — how `kj install-tools` installs Docker per platform.
//  · Linux: prefer the distro package manager (apt/dnf), else the official
//    convenience script — downloaded to a file, never piped blindly into sh.
//  · macOS/Windows: never auto-install; point at the official docs.

describe("dockerInstallPlan — Linux", () => {
  it("prefers apt (docker.io) with sudo when apt is available", () => {
    const p = dockerInstallPlan("linux", { apt: true, dnf: false });
    expect(p.kind).toBe("package");
    expect(p.manager).toBe("apt");
    expect(p.command).toBe("sudo apt-get install -y docker.io");
  });

  it("uses dnf (docker) with sudo when only dnf is available", () => {
    const p = dockerInstallPlan("linux", { apt: false, dnf: true });
    expect(p.kind).toBe("package");
    expect(p.manager).toBe("dnf");
    expect(p.command).toBe("sudo dnf install -y docker");
  });

  it("prefers apt over dnf when both are present", () => {
    const p = dockerInstallPlan("linux", { apt: true, dnf: true });
    expect(p.manager).toBe("apt");
  });

  it("falls back to the official script when no package manager matches", () => {
    const p = dockerInstallPlan("linux", { apt: false, dnf: false });
    expect(p.kind).toBe("script");
    expect(p.url).toBe("https://get.docker.com");
  });
});

describe("dockerInstallPlan — macOS / Windows", () => {
  it("never auto-installs on macOS; suggests brew cask when present", () => {
    const p = dockerInstallPlan("darwin", { brew: true });
    expect(p.kind).toBe("manual");
    expect(p.suggested).toBe("brew install --cask docker");
    expect(p.manualUrl).toMatch(/get-docker/);
  });

  it("never auto-installs on Windows; no brew suggestion", () => {
    const p = dockerInstallPlan("win32", {});
    expect(p.kind).toBe("manual");
    expect(p.suggested).toBeNull();
    expect(p.manualUrl).toMatch(/get-docker/);
  });
});
