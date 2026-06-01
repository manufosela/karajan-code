import { describe, it, expect, vi } from "vitest";
import { pickSonarScanner } from "../../src/sonar/scanner.js";

const fakeFind = (bin) => vi.fn().mockResolvedValue(bin);

describe("[opt-in: sonar] pickSonarScanner", () => {
  it("forces docker when scanner.command='docker'", async () => {
    const pick = await pickSonarScanner({ command: "docker" }, {
      findNativeSonarScanner: fakeFind("/usr/local/bin/sonar-scanner"),
      arch: "arm64"
    });
    expect(pick.type).toBe("docker");
  });

  it("uses native when scanner.command='native' and binary exists", async () => {
    const pick = await pickSonarScanner({ command: "native" }, {
      findNativeSonarScanner: fakeFind("/opt/homebrew/bin/sonar-scanner"),
      arch: "x64"
    });
    expect(pick.type).toBe("native");
    expect(pick.bin).toBe("/opt/homebrew/bin/sonar-scanner");
  });

  it("uses absolute path when scanner.command points to a binary", async () => {
    const find = vi.fn();
    const pick = await pickSonarScanner({ command: "/custom/path/sonar-scanner" }, {
      findNativeSonarScanner: find,
      arch: "x64"
    });
    expect(pick.type).toBe("native");
    expect(pick.bin).toBe("/custom/path/sonar-scanner");
    expect(find).not.toHaveBeenCalled();
  });

  it("falls back to docker when native is forced but binary not found", async () => {
    const pick = await pickSonarScanner({ command: "native" }, {
      findNativeSonarScanner: fakeFind(null),
      arch: "x64"
    });
    expect(pick.type).toBe("docker");
    expect(pick.reason).toMatch(/not found/);
  });

  it("auto-prefers native on ARM64 when binary exists", async () => {
    const pick = await pickSonarScanner({}, {
      findNativeSonarScanner: fakeFind("/opt/homebrew/bin/sonar-scanner"),
      arch: "arm64"
    });
    expect(pick.type).toBe("native");
    expect(pick.reason).toMatch(/ARM64/);
  });

  it("uses docker on ARM64 when native binary missing", async () => {
    const pick = await pickSonarScanner({}, {
      findNativeSonarScanner: fakeFind(null),
      arch: "arm64"
    });
    expect(pick.type).toBe("docker");
  });

  it("uses docker by default on x64 even if native binary exists", async () => {
    const find = vi.fn();
    const pick = await pickSonarScanner({}, {
      findNativeSonarScanner: find,
      arch: "x64"
    });
    expect(pick.type).toBe("docker");
    expect(find).not.toHaveBeenCalled();
  });
});
