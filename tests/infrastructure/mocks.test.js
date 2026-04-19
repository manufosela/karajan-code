import { describe, expect, it } from "vitest";
import {
  MockFileSystem,
  MockCommandRunner,
  buildMockEnvironment
} from "../../src/infrastructure/mocks.js";

describe("MockFileSystem", () => {
  it("returns files seeded via constructor", async () => {
    const fs = new MockFileSystem({ "/tmp/a.txt": "hello" });
    expect(await fs.readFile("/tmp/a.txt")).toBe("hello");
    expect(await fs.exists("/tmp/a.txt")).toBe(true);
  });

  it("throws ENOENT for missing files", async () => {
    const fs = new MockFileSystem();
    await expect(fs.readFile("/nope.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writeFile + exists + readFile round-trips", async () => {
    const fs = new MockFileSystem();
    expect(await fs.exists("/x.txt")).toBe(false);
    await fs.writeFile("/x.txt", "world");
    expect(await fs.exists("/x.txt")).toBe(true);
    expect(await fs.readFile("/x.txt")).toBe("world");
  });

  it("appendFile concatenates to existing content", async () => {
    const fs = new MockFileSystem({ "/log.txt": "a" });
    await fs.appendFile("/log.txt", "b");
    await fs.appendFile("/log.txt", "c");
    expect(await fs.readFile("/log.txt")).toBe("abc");
  });

  it("readdir lists direct children of a prefix", async () => {
    const fs = new MockFileSystem({
      "/dir/one.txt": "1",
      "/dir/two.txt": "2",
      "/dir/nested/three.txt": "3"
    });
    const entries = (await fs.readdir("/dir")).sort();
    expect(entries).toEqual(["nested", "one.txt", "two.txt"]);
  });

  it("copyFile duplicates content", async () => {
    const fs = new MockFileSystem({ "/src.txt": "payload" });
    await fs.copyFile("/src.txt", "/dest.txt");
    expect(await fs.readFile("/dest.txt")).toBe("payload");
  });

  it("stat reports file vs directory", async () => {
    const fs = new MockFileSystem({ "/a.txt": "data" });
    await fs.ensureDir("/mydir");
    const fileStat = await fs.stat("/a.txt");
    const dirStat = await fs.stat("/mydir");
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.isDirectory()).toBe(false);
    expect(dirStat.isDirectory()).toBe(true);
    expect(dirStat.isFile()).toBe(false);
  });

  it("records every call for assertion", async () => {
    const fs = new MockFileSystem({ "/x": "hi" });
    await fs.readFile("/x");
    await fs.writeFile("/y", "z");
    expect(fs.calls.map(c => c.op)).toEqual(["readFile", "writeFile"]);
  });
});

describe("MockCommandRunner", () => {
  it("returns default when queue is empty", async () => {
    const runner = new MockCommandRunner();
    const res = await runner.run("ls");
    expect(res).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("drains enqueue() responses in FIFO order", async () => {
    const runner = new MockCommandRunner()
      .enqueue({ stdout: "first" })
      .enqueue({ stdout: "second", exitCode: 1 });

    const a = await runner.run("node", ["-v"]);
    const b = await runner.run("node", ["-v"]);

    expect(a.stdout).toBe("first");
    expect(a.exitCode).toBe(0); // defaulted
    expect(b.stdout).toBe("second");
    expect(b.exitCode).toBe(1);
  });

  it("setResponder decides per-invocation", async () => {
    const runner = new MockCommandRunner().setResponder(({ args }) => ({
      exitCode: 0,
      stdout: `ran ${args.join(" ")}`,
      stderr: ""
    }));
    const res = await runner.run("echo", ["hello", "world"]);
    expect(res.stdout).toBe("ran hello world");
  });

  it("records every invocation with its args and options", async () => {
    const runner = new MockCommandRunner();
    await runner.run("git", ["status"], { cwd: "/repo" });
    await runner.run("npm", ["test"]);
    expect(runner.calls).toHaveLength(2);
    expect(runner.lastCall).toMatchObject({ command: "npm", args: ["test"] });
    expect(runner.calls[0]).toMatchObject({ command: "git", args: ["status"] });
    expect(runner.calls[0].options.cwd).toBe("/repo");
  });
});

describe("buildMockEnvironment", () => {
  it("returns a frozen environment with fs + runner instances", () => {
    const { env, fs, runner } = buildMockEnvironment({ files: { "/a": "x" } });
    expect(env.fs).toBe(fs);
    expect(env.runner).toBe(runner);
    expect(Object.isFrozen(env)).toBe(true);
    expect(fs).toBeInstanceOf(MockFileSystem);
    expect(runner).toBeInstanceOf(MockCommandRunner);
  });
});
