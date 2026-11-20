import { describe, expect, it } from "vitest";
import { describeSpawn } from "./governed-repo.js";

describe("describeSpawn (HU-4712)", () => {
  it("keeps the output of a normal run as before: exit code, then stdout and stderr", () => {
    expect(describeSpawn({ status: 0, signal: null, stdout: "out\n", stderr: "err\n" })).toBe("exit 0\nout\nerr\n");
  });

  it("names the signal when the child was killed by one", () => {
    const text = describeSpawn({ status: null, signal: "SIGTERM", stdout: "", stderr: "" });
    expect(text).toBe("exit null\nsignal SIGTERM\n");
  });

  it("names the error code when the spawn failed, such as on the timeout", () => {
    const text = describeSpawn({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" }, stdout: "partial", stderr: "" });
    expect(text).toBe("exit null\nsignal SIGTERM\nerror ETIMEDOUT\npartial");
  });

  it("falls back to the error message when it has no code", () => {
    expect(describeSpawn({ status: null, signal: null, error: new Error("spawn boom"), stdout: null, stderr: null })).toBe(
      "exit null\nerror spawn boom\n",
    );
  });
});
