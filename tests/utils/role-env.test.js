// KJC-TSK-0693 — credential hygiene: agent subprocesses receive an env
// allowlist, not the user's whole environment. A compromised agent or an
// injected prompt cannot exfiltrate what it never received.

import { describe, it, expect } from "vitest";
import { buildAgentEnv } from "../../src/utils/role-env.js";
import { BaseAgent } from "../../src/agents/base-agent.js";
import { buildEnvironment } from "../../src/infrastructure/environment.js";

const BASE = {
  PATH: "/usr/bin", HOME: "/home/u", TERM: "xterm", LANG: "es_ES.UTF-8",
  KJ_LANE_SLOT: "2", NODE_OPTIONS: "--max-old-space-size=4096",
  ANTHROPIC_API_KEY: "sk-ant", OPENAI_API_KEY: "sk-oai", GEMINI_API_KEY: "g",
  AWS_SECRET_ACCESS_KEY: "aws-secret", NPM_TOKEN: "npm-secret",
  GITHUB_TOKEN: "gh-secret", DATABASE_URL: "postgres://x",
};

describe("buildAgentEnv", () => {
  it("keeps essentials and agent/kj prefixes, drops unrelated secrets", () => {
    const env = buildAgentEnv(BASE);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    expect(env.KJ_LANE_SLOT).toBe("2");
    expect(env.NODE_OPTIONS).toBeDefined();
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant");
    expect(env.OPENAI_API_KEY).toBe("sk-oai");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("GITHUB_/GH_ only reach the agent that authenticates with them (copilot)", () => {
    expect(buildAgentEnv(BASE).GITHUB_TOKEN).toBeUndefined();
    expect(buildAgentEnv(BASE, { agent: "claude" }).GITHUB_TOKEN).toBeUndefined();
    expect(buildAgentEnv(BASE, { agent: "copilot" }).GITHUB_TOKEN).toBe("gh-secret");
  });

  it("a complete Windows env keeps Path and child-process essentials", () => {
    const win = {
      Path: "C:\\Windows\\System32", SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\System32\\cmd.exe",
      PATHEXT: ".COM;.EXE;.BAT", USERPROFILE: "C:\\Users\\u", APPDATA: "C:\\Users\\u\\AppData\\Roaming",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
    };
    const env = buildAgentEnv(win);
    expect(env.Path).toBe("C:\\Windows\\System32");
    expect(env.SystemRoot).toBeDefined();
    expect(env.ComSpec).toBeDefined();
    expect(env.PATHEXT).toBeDefined();
    expect(env.USERPROFILE).toBeDefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("passthrough admits exact names and trailing-* globs", () => {
    const env = buildAgentEnv(BASE, { passthrough: ["DATABASE_URL", "AWS_*"] });
    expect(env.DATABASE_URL).toBe("postgres://x");
    expect(env.AWS_SECRET_ACCESS_KEY).toBe("aws-secret");
    expect(env.NPM_TOKEN).toBeUndefined(); // not listed → still out
  });
});

describe("BaseAgent.runCommand env filtering", () => {
  const runWith = (config, options = {}) => {
    const seen = [];
    const runner = { run: (_c, _a, opts) => { seen.push(opts); return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }); } };
    const agent = new BaseAgent("codex", config, console, buildEnvironment({ runner }));
    return agent.runCommand("codex", [], options).then(() => seen[0]);
  };

  it("filters the inherited env by default (secrets absent, essentials present)", async () => {
    process.env.KJ_TEST_SECRET_0693 = "leak-me";
    process.env.AWS_SECRET_ACCESS_KEY ??= "aws-secret-test";
    try {
      const opts = await runWith({});
      expect(opts.env).toBeDefined();
      expect(opts.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(opts.env.KJ_TEST_SECRET_0693).toBe("leak-me"); // KJ_ prefix rides along
      expect(opts.env.PATH).toBeDefined();
    } finally {
      delete process.env.KJ_TEST_SECRET_0693;
      if (process.env.AWS_SECRET_ACCESS_KEY === "aws-secret-test") delete process.env.AWS_SECRET_ACCESS_KEY;
    }
  });

  it("filters an explicitly provided env too, and security.env_allowlist:false opts out", async () => {
    const explicit = await runWith({}, { env: { ...BASE } });
    expect(explicit.env.NPM_TOKEN).toBeUndefined();
    expect(explicit.env.ANTHROPIC_API_KEY).toBe("sk-ant");
    const off = await runWith({ security: { env_allowlist: false } }, { env: { ...BASE } });
    expect(off.env.NPM_TOKEN).toBe("npm-secret");
  });

  it("security.env_passthrough reaches the subprocess", async () => {
    const opts = await runWith({ security: { env_passthrough: ["DATABASE_URL"] } }, { env: { ...BASE } });
    expect(opts.env.DATABASE_URL).toBe("postgres://x");
  });

  // Solomon-arbitrated: env WITHOUT PATH = partial overlay → merges over the
  // inherited env (child keeps PATH); env WITH PATH = complete → as given
  // (a var deliberately stripped by the agent must NOT resurface).
  it("a partial overlay keeps PATH; a complete env respects deliberate strips", async () => {
    process.env.KJC_0693_STRIPPED ??= "in-parent";
    try {
      const overlay = await runWith({}, { env: { KJ_LANE_SLOT: "3" } });
      expect(overlay.env.PATH).toBeDefined();
      expect(overlay.env.KJ_LANE_SLOT).toBe("3");
      const complete = await runWith({}, { env: { ...BASE } }); // no KJC_0693_STRIPPED
      expect(complete.env.KJC_0693_STRIPPED).toBeUndefined();
    } finally {
      if (process.env.KJC_0693_STRIPPED === "in-parent") delete process.env.KJC_0693_STRIPPED;
    }
  });
});
