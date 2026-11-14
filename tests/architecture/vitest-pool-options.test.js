// KJC-BUG-0591: Vitest 4 removed `test.poolOptions`; its keys are top-level
// options now. The root config must not reintroduce the removed key.
import { describe, it, expect } from "vitest";
import config from "../../vitest.config.js";

describe("vitest pool options", () => {
  it("does not use the removed test.poolOptions key", () => {
    expect(config.test).not.toHaveProperty("poolOptions");
  });

  it("runs forks with at most 6 workers at the top level", () => {
    expect(config.test.pool).toBe("forks");
    expect(config.test.maxWorkers).toBe(6);
  });
});
