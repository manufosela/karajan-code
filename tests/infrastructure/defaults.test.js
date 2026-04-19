import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultFileSystem } from "../../src/infrastructure/file-system-service.js";
import { defaultCommandRunner } from "../../src/infrastructure/command-runner.js";
import { defaultEnvironment, buildEnvironment } from "../../src/infrastructure/environment.js";
import { MockCommandRunner, MockFileSystem } from "../../src/infrastructure/mocks.js";

let workdir;

beforeAll(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-infra-"));
});

afterAll(async () => {
  if (workdir) await fs.rm(workdir, { recursive: true, force: true });
});

describe("defaultFileSystem", () => {
  it("writes and reads through the native node:fs surface", async () => {
    const file = path.join(workdir, "default.txt");
    await defaultFileSystem.writeFile(file, "payload");
    expect(await defaultFileSystem.readFile(file)).toBe("payload");
    expect(await defaultFileSystem.exists(file)).toBe(true);
  });

  it("exists() returns false for missing paths without throwing", async () => {
    expect(await defaultFileSystem.exists(path.join(workdir, "nope"))).toBe(false);
  });

  it("ensureDir is idempotent", async () => {
    const dir = path.join(workdir, "sub/nested/deep");
    await defaultFileSystem.ensureDir(dir);
    await defaultFileSystem.ensureDir(dir);
    const stat = await defaultFileSystem.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("defaultCommandRunner", () => {
  it("runs a real command and returns stdout", async () => {
    // node -p "1+2" is a minimal cross-platform smoke that doesn't depend on
    // any external binary beyond the runtime itself.
    const res = await defaultCommandRunner.run(process.execPath, ["-p", "1+2"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("3");
  });
});

describe("buildEnvironment", () => {
  it("returns defaults when no overrides are supplied", () => {
    const env = buildEnvironment();
    expect(env.fs).toBe(defaultEnvironment.fs);
    expect(env.runner).toBe(defaultEnvironment.runner);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it("supports swapping just the runner", () => {
    const runner = new MockCommandRunner();
    const env = buildEnvironment({ runner });
    expect(env.runner).toBe(runner);
    expect(env.fs).toBe(defaultEnvironment.fs);
  });

  it("supports swapping just the fs", () => {
    const mockFs = new MockFileSystem();
    const env = buildEnvironment({ fs: mockFs });
    expect(env.fs).toBe(mockFs);
    expect(env.runner).toBe(defaultEnvironment.runner);
  });
});
