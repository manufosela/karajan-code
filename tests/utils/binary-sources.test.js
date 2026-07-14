import { describe, it, expect } from "vitest";
import { osvScannerSource, semgrepFallback, resolveStandalone } from "../../src/utils/binary-sources.js";

// KJC-TSK-0607 — standalone routes for tools with no package manager:
//  · osv-scanner ships a static per-platform binary on its GitHub releases.
//  · semgrep has no single binary — offer a concrete command (docker / pipx).

describe("osvScannerSource", () => {
  it("maps linux x64 to the amd64 release asset", () => {
    const s = osvScannerSource("linux", "x64");
    expect(s.url).toBe("https://github.com/google/osv-scanner/releases/latest/download/osv-scanner_linux_amd64");
    expect(s.name).toBe("osv-scanner");
  });

  it("maps darwin arm64 to the darwin_arm64 asset", () => {
    const s = osvScannerSource("darwin", "arm64");
    expect(s.url).toMatch(/osv-scanner_darwin_arm64$/);
    expect(s.name).toBe("osv-scanner");
  });

  it("appends .exe on windows", () => {
    const s = osvScannerSource("win32", "x64");
    expect(s.url).toMatch(/osv-scanner_windows_amd64\.exe$/);
    expect(s.name).toBe("osv-scanner.exe");
  });

  it("returns null for unsupported architecture", () => {
    expect(osvScannerSource("linux", "ia32")).toBeNull();
  });

  it("returns null for unsupported platform", () => {
    expect(osvScannerSource("freebsd", "x64")).toBeNull();
  });
});

describe("semgrepFallback", () => {
  it("prefers the docker image when docker is available", () => {
    const f = semgrepFallback({ docker: true });
    expect(f.via).toBe("docker");
    expect(f.command).toMatch(/semgrep\/semgrep/);
  });

  it("bootstraps pipx when docker is absent", () => {
    const f = semgrepFallback({});
    expect(f.via).toBe("pipx");
    expect(f.command).toMatch(/pipx install semgrep/);
  });
});

describe("resolveStandalone", () => {
  it("gives osv-scanner a binary route", () => {
    const r = resolveStandalone("osv-scanner", {}, "linux", "x64");
    expect(r.kind).toBe("binary");
    expect(r.url).toMatch(/osv-scanner_linux_amd64$/);
  });

  it("gives semgrep a command route", () => {
    const r = resolveStandalone("semgrep", { docker: true });
    expect(r.kind).toBe("command");
    expect(r.command).toMatch(/semgrep/);
  });

  it("returns null for tools with no standalone route", () => {
    expect(resolveStandalone("lighthouse", {})).toBeNull();
  });
});
