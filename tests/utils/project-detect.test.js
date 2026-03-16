import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { detectTestFramework, detectSonarConfig } from "../../src/utils/project-detect.js";

describe("detectTestFramework", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-detect-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("detects vitest in devDependencies", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ devDependencies: { vitest: "^1.0.0" } })
    );

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("vitest");
  });

  it("detects jest in dependencies", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { jest: "^29.0.0" } })
    );

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("jest");
  });

  it("detects @jest/core in devDependencies", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ devDependencies: { "@jest/core": "^29.0.0" } })
    );

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("@jest/core");
  });

  it("detects mocha in devDependencies", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ devDependencies: { mocha: "^10.0.0" } })
    );

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("mocha");
  });

  it("detects @playwright/test in devDependencies", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } })
    );

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("@playwright/test");
  });

  it("returns hasTests=false when no test framework found", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0" }, devDependencies: { eslint: "^8.0.0" } })
    );

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(false);
    expect(result.framework).toBeNull();
  });

  it("returns hasTests=false when no package.json exists", async () => {
    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(false);
    expect(result.framework).toBeNull();
  });

  it("detects vitest config file when no package.json dependency", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.0.0" } })
    );
    await fs.writeFile(path.join(tmpDir, "vitest.config.ts"), "export default {}");

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("vitest");
  });

  it("detects jest config file when no package.json dependency", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ dependencies: {} })
    );
    await fs.writeFile(path.join(tmpDir, "jest.config.js"), "module.exports = {}");

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("jest");
  });

  it("detects .mocharc.yml config file", async () => {
    await fs.writeFile(path.join(tmpDir, ".mocharc.yml"), "spec: test/**/*.test.js");

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("mocha");
  });

  it("detects playwright config file", async () => {
    await fs.writeFile(path.join(tmpDir, "playwright.config.ts"), "export default {}");

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("playwright");
  });

  it("prefers package.json dependency over config file", async () => {
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ devDependencies: { vitest: "^1.0.0" } })
    );
    await fs.writeFile(path.join(tmpDir, "jest.config.js"), "module.exports = {}");

    const result = await detectTestFramework(tmpDir);
    expect(result.hasTests).toBe(true);
    expect(result.framework).toBe("vitest");
  });
});

describe("detectSonarConfig", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-detect-sonar-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns configured=true when sonar-project.properties exists", async () => {
    await fs.writeFile(path.join(tmpDir, "sonar-project.properties"), "sonar.projectKey=my-project");

    const result = await detectSonarConfig(tmpDir);
    expect(result.configured).toBe(true);
  });

  it("returns configured=false when sonar-project.properties does not exist", async () => {
    const result = await detectSonarConfig(tmpDir);
    expect(result.configured).toBe(false);
  });
});
