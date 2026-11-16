import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { buildKjEnv } from "./helpers/spawn-kj.js";

const OWN_HOME = "/tmp/kj-e2e-own-home";
const OTHER_HOME = "/tmp/kj-e2e-some-other-home";

describe("buildKjEnv", () => {
  let saved;
  beforeEach(() => {
    saved = { ...process.env };
    process.env.KARAJAN_HOME = OTHER_HOME;
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it("drops an inherited KARAJAN_HOME and points KJ_HOME at the test home", () => {
    const env = buildKjEnv({ homeForRun: OWN_HOME });
    expect(env.KARAJAN_HOME).toBeUndefined();
    expect(env.KJ_HOME).toBe(OWN_HOME);
  });

  it("keeps a KARAJAN_HOME passed explicitly in the env option", () => {
    const env = buildKjEnv({ homeForRun: OWN_HOME, env: { KARAJAN_HOME: "/explicit" } });
    expect(env.KARAJAN_HOME).toBe("/explicit");
  });

  it("an undefined value really drops the variable for spawnSync", () => {
    const env = buildKjEnv({ homeForRun: OWN_HOME });
    const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String('KARAJAN_HOME' in process.env))"], {
      encoding: "utf8",
      env,
    });
    expect(r.stdout).toBe("false");
  });
});
