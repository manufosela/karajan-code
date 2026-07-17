// PAR-H (KJC-TSK-0631): lane env vars reach the acceptance-test subprocesses.
import { describe, expect, it, vi } from "vitest";

const runCommandMock = vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }));
vi.mock("../src/utils/process.js", () => ({ runCommand: (...args) => runCommandMock(...args) }));

const { runAcceptanceTests } = await import("../src/hu/acceptance-runner.js");

describe("runAcceptanceTests lane env (PAR-H)", () => {
  it("forwards env to the shell subprocess", async () => {
    await runAcceptanceTests(["echo hi"], "/proj", { env: { KJ_LANE_SLOT: "2", KJ_PORT_OFFSET: "200" } });
    expect(runCommandMock).toHaveBeenCalledWith("bash", ["-c", "echo hi"], expect.objectContaining({
      cwd: "/proj",
      env: { KJ_LANE_SLOT: "2", KJ_PORT_OFFSET: "200" }
    }));
  });

  it("omits env entirely when no lane env is given (legacy behavior)", async () => {
    runCommandMock.mockClear();
    await runAcceptanceTests(["echo hi"], "/proj");
    const opts = runCommandMock.mock.calls[0][2];
    expect("env" in opts).toBe(false);
  });
});
