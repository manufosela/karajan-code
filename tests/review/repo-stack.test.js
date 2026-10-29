// KJC-TSK-1267 (#2753): the reviewed repo's stack, read at the BASE, picks the
// skills a third-party reviewer gets; the PR cannot invent a stack.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectStack } from "../../src/review/repo-stack.js";

let dir;
const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const commit = () => { git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "c"); return git("rev-parse", "HEAD"); };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-repo-stack-")); git("init", "-q"); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("detectStack", () => {
  it("names the languages by extension and the frameworks by the manifests' dependencies", async () => {
    write("package.json", JSON.stringify({ dependencies: { astro: "^5", lit: "^3" }, devDependencies: { vitest: "^4" } }));
    write("src/pages/index.astro", "---\n---\n");
    write("src/x.ts", "export {};\n");
    write("api/requirements.txt", "fastapi==0.1\n");
    write("api/main.py", "print(1)\n");
    const base = commit();
    const stack = await detectStack({ projectDir: dir, base });
    expect(stack.languages).toEqual(["astro", "python", "typescript"]);
    expect(stack.frameworks).toEqual(["astro", "fastapi", "lit", "vitest"]);
  });

  it("knows a scoped package by its scope and an artifact by its head", async () => {
    write("web/package.json", JSON.stringify({ dependencies: { "@angular/core": "^20" }, optionalDependencies: { "@nestjs/common": "^11" } }));
    write("svc/build.gradle.kts", 'implementation("org.springframework.boot:spring-boot-starter-web")\n');
    const base = commit();
    expect((await detectStack({ projectDir: dir, base })).frameworks).toEqual(["angular", "nestjs", "spring-boot"]);
  });

  it("reads the base, so a framework the PR adds does not count", async () => {
    write("package.json", JSON.stringify({ dependencies: {} }));
    write("x.js", "1\n");
    const base = commit();
    write("package.json", JSON.stringify({ dependencies: { react: "^19" } }));
    commit();
    const stack = await detectStack({ projectDir: dir, base });
    expect(stack).toEqual({ languages: ["javascript"], frameworks: [] });
  });

  it("names a manifest that does not parse instead of failing the review or dropping it", async () => {
    write("package.json", JSON.stringify({ dependencies: { vue: "^3" } }));
    write("tests/fixtures/broken/package.json", "{ not json");
    const base = commit();
    const stack = await detectStack({ projectDir: dir, base });
    expect(stack.frameworks).toEqual(["vue"]);
    expect(stack.unreadable).toEqual(["tests/fixtures/broken/package.json"]);
  });

  it("fails loudly when the base cannot be read", async () => {
    await expect(detectStack({ projectDir: dir, base: "no-such-ref" })).rejects.toThrow(/no-such-ref/);
  });
});
