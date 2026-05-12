import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock getKarajanHome to use a temp directory
let tmpDir;
vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: () => tmpDir
}));

describe("kj_hu tool", () => {
  let projectDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-hu-tool-test-"));
    projectDir = path.join(tmpDir, "my-test-project");
    await fs.mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("create HU stores it in hu-stories directory", async () => {
    const { createManualHu } = await import("../src/hu/store.js");
    const hu = await createManualHu(projectDir, {
      title: "Add login page",
      description: "Create a login page with email/password",
      acceptanceCriteria: "Given a user, when they enter credentials, then they are authenticated"
    });

    expect(hu.id).toMatch(/^HU-/);
    expect(hu.title).toBe("Add login page");
    expect(hu.description).toBe("Create a login page with email/password");
    expect(hu.status).toBe("pending");
    expect(hu.acceptanceCriteria).toContain("Given a user");
    expect(hu.createdAt).toBeDefined();

    // Verify file on disk
    const batchPath = path.join(tmpDir, "hu-stories", "my-test-project", "batch.json");
    const raw = await fs.readFile(batchPath, "utf8");
    const batch = JSON.parse(raw);
    expect(batch.stories).toHaveLength(1);
    expect(batch.stories[0].title).toBe("Add login page");
  });

  it("create HU in new project auto-creates batch file", async () => {
    const { createManualHu } = await import("../src/hu/store.js");
    const newProjectDir = path.join(tmpDir, "brand-new-project");
    await fs.mkdir(newProjectDir, { recursive: true });

    const hu = await createManualHu(newProjectDir, { title: "First story" });

    expect(hu.title).toBe("First story");
    expect(hu.status).toBe("pending");

    // Verify file was auto-created
    const batchPath = path.join(tmpDir, "hu-stories", "brand-new-project", "batch.json");
    const stat = await fs.stat(batchPath);
    expect(stat.isFile()).toBe(true);
  });

  it("list HUs returns all HUs for the project", async () => {
    const { createManualHu, listHus } = await import("../src/hu/store.js");
    await createManualHu(projectDir, { title: "Story A" });
    await createManualHu(projectDir, { title: "Story B", status: "coding" });
    await createManualHu(projectDir, { title: "Story C" });

    const hus = await listHus(projectDir);
    expect(hus).toHaveLength(3);
    expect(hus[0].title).toBe("Story A");
    expect(hus[1].title).toBe("Story B");
    expect(hus[1].status).toBe("coding");
    expect(hus[2].title).toBe("Story C");
    // Each item has the expected shape
    for (const hu of hus) {
      expect(hu).toHaveProperty("id");
      expect(hu).toHaveProperty("title");
      expect(hu).toHaveProperty("status");
      expect(hu).toHaveProperty("createdAt");
    }
  });

  it("get HU by id returns correct HU", async () => {
    const { createManualHu, getHu } = await import("../src/hu/store.js");
    const created = await createManualHu(projectDir, {
      title: "Specific story",
      description: "Details here"
    });

    const fetched = await getHu(projectDir, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe("Specific story");
    expect(fetched.description).toBe("Details here");
  });

  it("update HU status changes the status", async () => {
    const { createManualHu, updateHuStatus, getHu } = await import("../src/hu/store.js");
    const created = await createManualHu(projectDir, { title: "Update me" });

    // Small delay to ensure updatedAt differs
    await new Promise(r => setTimeout(r, 5));
    const updated = await updateHuStatus(projectDir, created.id, "done");
    expect(updated.status).toBe("done");
    expect(updated.updatedAt).not.toBe(created.createdAt);

    // Verify persistence
    const fetched = await getHu(projectDir, created.id);
    expect(fetched.status).toBe("done");
  });

  it("create without title returns error", async () => {
    const { createManualHu } = await import("../src/hu/store.js");
    await expect(
      createManualHu(projectDir, { description: "No title" })
    ).rejects.toThrow("title is required");
  });

  it("update non-existent HU returns error", async () => {
    const { updateHuStatus } = await import("../src/hu/store.js");
    await expect(
      updateHuStatus(projectDir, "HU-nonexistent", "done")
    ).rejects.toThrow("HU HU-nonexistent not found");
  });

  it("project detection from directory name works", async () => {
    const { detectProject } = await import("../src/hu/store.js");
    const result = await detectProject(projectDir);
    expect(result.name).toBe("my-test-project");
    // No git repo in temp dir, so remoteUrl should be null
    expect(result.remoteUrl).toBeNull();
  });
});
