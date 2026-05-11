import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { extractHostPort, discoverRunningSonar } from "../src/sonar/discovery.js";

describe("extractHostPort", () => {
  it("returns the host port when published with the standard 0.0.0.0 binding", () => {
    expect(extractHostPort("0.0.0.0:9000->9000/tcp")).toBe(9000);
  });

  it("returns the host port when published on a non-default host port", () => {
    expect(extractHostPort("0.0.0.0:9001->9000/tcp")).toBe(9001);
  });

  it("understands localhost-only bindings (127.0.0.1)", () => {
    expect(extractHostPort("127.0.0.1:9002->9000/tcp")).toBe(9002);
  });

  it("understands IPv6 bindings", () => {
    expect(extractHostPort("[::]:9003->9000/tcp")).toBe(9003);
  });

  it("returns null when the container has no host binding (internal-only)", () => {
    expect(extractHostPort("9000/tcp")).toBeNull();
  });

  it("returns null when the binding maps to a different internal port", () => {
    expect(extractHostPort("0.0.0.0:5432->5432/tcp")).toBeNull();
  });

  it("picks the smallest host port when several map to the same internal port", () => {
    expect(extractHostPort("0.0.0.0:9001->9000/tcp, 0.0.0.0:9000->9000/tcp")).toBe(9000);
  });

  it("returns null on empty / null input", () => {
    expect(extractHostPort("")).toBeNull();
    expect(extractHostPort(null)).toBeNull();
    expect(extractHostPort(undefined)).toBeNull();
  });

  it("respects an internalPort override (e.g. embedded sonar on 9001)", () => {
    expect(extractHostPort("0.0.0.0:9100->9001/tcp", 9001)).toBe(9100);
    expect(extractHostPort("0.0.0.0:9100->9001/tcp", 9000)).toBeNull();
  });
});

// Mock the process runner + reachability probe so we never actually
// shell out to docker / curl in the unit suite.
vi.mock("../src/utils/process.js", () => ({
  runCommand: vi.fn(),
}));
vi.mock("../src/sonar/manager.js", () => ({
  isSonarReachable: vi.fn(),
}));

describe("discoverRunningSonar", () => {
  let runCommand;
  let isSonarReachable;

  beforeEach(async () => {
    runCommand = (await import("../src/utils/process.js")).runCommand;
    isSonarReachable = (await import("../src/sonar/manager.js")).isSonarReachable;
    runCommand.mockReset();
    isSonarReachable.mockReset();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("returns found:false when docker ps fails", async () => {
    runCommand.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "docker: command not found" });
    const result = await discoverRunningSonar();
    expect(result).toEqual({ found: false });
  });

  it("returns found:false when no running container looks like Sonar", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "abc123|some-app|node:20|0.0.0.0:3000->3000/tcp\ndef456|db|postgres:16|0.0.0.0:5432->5432/tcp",
    });
    const result = await discoverRunningSonar();
    expect(result.found).toBe(false);
  });

  it("finds a container with image sonarqube:community on the standard port", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "abc123|karajan-sonarqube|sonarqube:community|0.0.0.0:9000->9000/tcp",
    });
    isSonarReachable.mockResolvedValue(true);
    const result = await discoverRunningSonar();
    expect(result).toMatchObject({
      found: true,
      containerName: "karajan-sonarqube",
      image: "sonarqube:community",
      port: 9000,
      host: "http://localhost:9000",
      reachable: true,
    });
  });

  it("finds a container running under a different name and non-default port", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "abc|some-other-sonar|sonarqube:lts|0.0.0.0:9015->9000/tcp",
    });
    isSonarReachable.mockResolvedValue(true);
    const result = await discoverRunningSonar();
    expect(result.found).toBe(true);
    expect(result.containerName).toBe("some-other-sonar");
    expect(result.port).toBe(9015);
    expect(result.host).toBe("http://localhost:9015");
  });

  it("ignores sonarqube containers without a host port (internal-only network)", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "abc|sonar-internal|sonarqube:community|9000/tcp",
    });
    const result = await discoverRunningSonar();
    expect(result.found).toBe(false);
  });

  it("matches case-insensitively in the image name", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "x|s|MyOrg/SonarQube:custom|0.0.0.0:9020->9000/tcp",
    });
    isSonarReachable.mockResolvedValue(true);
    const result = await discoverRunningSonar();
    expect(result.found).toBe(true);
    expect(result.port).toBe(9020);
  });

  it("returns reachable:false when discovery succeeds but HTTP probe fails", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "x|s|sonarqube:community|0.0.0.0:9000->9000/tcp",
    });
    isSonarReachable.mockResolvedValue(false);
    const result = await discoverRunningSonar();
    expect(result.found).toBe(true);
    expect(result.reachable).toBe(false);
  });

  it("skips the HTTP probe when probe:false is passed", async () => {
    runCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "x|s|sonarqube:community|0.0.0.0:9000->9000/tcp",
    });
    const result = await discoverRunningSonar({ probe: false });
    expect(result.reachable).toBe(true);
    expect(isSonarReachable).not.toHaveBeenCalled();
  });

  it("survives docker / curl throwing without crashing the caller", async () => {
    runCommand.mockRejectedValue(new Error("EACCES /var/run/docker.sock"));
    const result = await discoverRunningSonar();
    expect(result).toEqual({ found: false });
  });
});
