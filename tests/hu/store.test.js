import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createHuBatch,
  loadHuBatch,
  saveHuBatch,
  updateStoryStatus,
  updateStoryQuality,
  updateStoryCertified,
  addContextRequest,
  answerContextRequest
} from "../../src/hu/store.js";

describe("HU Store", () => {
  let tmpDir;
  const origEnv = process.env.KJ_HOME;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-hu-store-"));
    process.env.KJ_HOME = tmpDir;
  });

  afterEach(async () => {
    process.env.KJ_HOME = origEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("createHuBatch creates directory and writes JSON", async () => {
    const stories = [
      { id: "HU-001", text: "As a user, I want login", blocked_by: [] },
      { text: "As a doctor, I want to see patients" }
    ];
    const batch = await createHuBatch("test-session", stories);

    expect(batch.session_id).toBe("test-session");
    expect(batch.stories).toHaveLength(2);
    expect(batch.stories[0].id).toBe("HU-001");
    expect(batch.stories[0].status).toBe("pending");
    expect(batch.stories[0].original.text).toBe("As a user, I want login");
    expect(batch.stories[1].id).toMatch(/^HU-/);

    // File exists on disk
    const file = path.join(tmpDir, "hu-stories", "test-session", "batch.json");
    const raw = await fs.readFile(file, "utf8");
    const disk = JSON.parse(raw);
    expect(disk.session_id).toBe("test-session");
  });

  it("loadHuBatch reads back correctly", async () => {
    const stories = [{ id: "HU-010", text: "Some story" }];
    await createHuBatch("load-test", stories);
    const loaded = await loadHuBatch("load-test");
    expect(loaded.session_id).toBe("load-test");
    expect(loaded.stories[0].id).toBe("HU-010");
  });

  it("saveHuBatch persists updated batch", async () => {
    const stories = [{ id: "HU-020", text: "Story" }];
    const batch = await createHuBatch("save-test", stories);
    batch.stories[0].status = "done";
    await saveHuBatch("save-test", batch);

    const reloaded = await loadHuBatch("save-test");
    expect(reloaded.stories[0].status).toBe("done");
    expect(reloaded.updated_at).toBeTruthy();
  });

  it("updateStoryStatus changes status", async () => {
    const batch = await createHuBatch("status-test", [{ id: "HU-030", text: "S" }]);
    const updated = updateStoryStatus(batch, "HU-030", "in_progress");
    expect(updated.status).toBe("in_progress");
    expect(batch.stories[0].status).toBe("in_progress");
  });

  it("updateStoryStatus throws on unknown story", async () => {
    const batch = await createHuBatch("unknown-test", [{ id: "HU-040", text: "S" }]);
    expect(() => updateStoryStatus(batch, "HU-999", "done")).toThrow("Story HU-999 not found");
  });

  it("updateStoryQuality stores scores", async () => {
    const batch = await createHuBatch("quality-test", [{ id: "HU-050", text: "S" }]);
    const quality = { D1_jtbd_context: 8, D2_user_specificity: 6 };
    updateStoryQuality(batch, "HU-050", quality);
    expect(batch.stories[0].quality.D1_jtbd_context).toBe(8);
    expect(batch.stories[0].quality.evaluated_at).toBeTruthy();
  });

  it("updateStoryCertified marks certified", async () => {
    const batch = await createHuBatch("cert-test", [{ id: "HU-060", text: "S" }]);
    const certifiedData = { as: "Dr. Garcia", want: "see patients" };
    updateStoryCertified(batch, "HU-060", certifiedData);
    expect(batch.stories[0].status).toBe("certified");
    expect(batch.stories[0].certified.as).toBe("Dr. Garcia");
  });

  it("addContextRequest adds request and changes status to needs_context", async () => {
    const batch = await createHuBatch("ctx-test", [{ id: "HU-070", text: "S" }]);
    addContextRequest(batch, "HU-070", { fields_needed: ["D2"], question: "Who is the user?" });
    expect(batch.stories[0].status).toBe("needs_context");
    expect(batch.stories[0].context_requests).toHaveLength(1);
    expect(batch.stories[0].context_requests[0].question_to_fde).toBe("Who is the user?");
    expect(batch.stories[0].context_requests[0].answered_at).toBeNull();
  });

  it("answerContextRequest stores answer and resets to pending", async () => {
    const batch = await createHuBatch("answer-test", [{ id: "HU-080", text: "S" }]);
    addContextRequest(batch, "HU-080", { fields_needed: ["D3"], question: "What metric?" });
    answerContextRequest(batch, "HU-080", "Reduce time by 30%");
    expect(batch.stories[0].status).toBe("pending");
    expect(batch.stories[0].context_requests[0].answered_at).toBeTruthy();
    expect(batch.stories[0].context_requests[0].answer).toBe("Reduce time by 30%");
  });

  it("status transitions are correct through the lifecycle", async () => {
    const batch = await createHuBatch("lifecycle-test", [{ id: "HU-090", text: "S" }]);
    expect(batch.stories[0].status).toBe("pending");

    addContextRequest(batch, "HU-090", { fields_needed: ["D1"], question: "Why?" });
    expect(batch.stories[0].status).toBe("needs_context");

    answerContextRequest(batch, "HU-090", "Because of X");
    expect(batch.stories[0].status).toBe("pending");

    updateStoryCertified(batch, "HU-090", { as: "user" });
    expect(batch.stories[0].status).toBe("certified");

    updateStoryStatus(batch, "HU-090", "done");
    expect(batch.stories[0].status).toBe("done");
  });
});
