import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { validateSplitCriteria, HORIZONTAL_PATTERNS } from "../src/hu/split-validator.js";

// Mock getKarajanHome to use a temp directory
let tmpDir;
vi.mock("../src/utils/paths.js", () => ({
  getKarajanHome: () => tmpDir
}));

// Dynamic import after mock is set up
const { createHuBatch, loadHuBatch, saveHuBatch, addSplittingMetadata } = await import("../src/hu/store.js");

describe("split-validator: validateSplitCriteria", () => {
  describe("is_vertical", () => {
    it("should fail for 'implement only the API endpoint'", () => {
      const result = validateSplitCriteria({
        title: "Implement only the API endpoint for users",
        text: "implement only the API endpoint"
      });
      expect(result.criteria.is_vertical).toBe(false);
      expect(result.valid).toBe(false);
    });

    it("should fail for 'solo el backend'", () => {
      const result = validateSplitCriteria({
        title: "Implementar solo el backend del sistema",
        text: "solo el backend"
      });
      expect(result.criteria.is_vertical).toBe(false);
    });

    it("should pass for a full vertical description", () => {
      const result = validateSplitCriteria({
        title: "User registration with email verification",
        text: "As a user, I want to register with email so that I can access the platform",
        descriptionStructured: [{ role: "user", goal: "register with email", benefit: "access the platform" }]
      });
      expect(result.criteria.is_vertical).toBe(true);
    });
  });

  describe("completable_in_3_days", () => {
    it("should fail for devPoints 5", () => {
      const result = validateSplitCriteria({
        title: "Large feature",
        text: "As a user, I want something so that I benefit",
        devPoints: 5
      });
      expect(result.criteria.completable_in_3_days).toBe(false);
    });

    it("should pass for devPoints 2", () => {
      const result = validateSplitCriteria({
        title: "Small feature",
        text: "As a user, I want something so that I benefit",
        devPoints: 2
      });
      expect(result.criteria.completable_in_3_days).toBe(true);
    });
  });

  describe("independently_valuable", () => {
    it("should pass with role/goal/benefit structure", () => {
      const result = validateSplitCriteria({
        title: "User login",
        descriptionStructured: [{ role: "user", goal: "log in", benefit: "access my account" }]
      });
      expect(result.criteria.independently_valuable).toBe(true);
    });

    it("should fail without goal", () => {
      const result = validateSplitCriteria({
        title: "Refactor database layer",
        text: "Refactor the database layer to improve performance"
      });
      expect(result.criteria.independently_valuable).toBe(false);
    });

    it("should pass with As a/I want/so that text pattern", () => {
      const result = validateSplitCriteria({
        title: "Export feature",
        text: "As a manager, I want to export reports so that I can share them with stakeholders"
      });
      expect(result.criteria.independently_valuable).toBe(true);
    });
  });

  describe("deployable_alone", () => {
    it("should fail for 'part 1 of 3'", () => {
      const result = validateSplitCriteria({
        title: "User registration - part 1 of 3",
        text: "This is part 1 of 3 of the user registration feature"
      });
      expect(result.criteria.deployable_alone).toBe(false);
    });

    it("should fail for 'depends on X being deployed first'", () => {
      const result = validateSplitCriteria({
        title: "Add notifications",
        text: "Depends on the messaging service being deployed first"
      });
      expect(result.criteria.deployable_alone).toBe(false);
    });

    it("should pass for independent story", () => {
      const result = validateSplitCriteria({
        title: "Add dark mode toggle",
        text: "As a user, I want a dark mode toggle so that I can reduce eye strain"
      });
      expect(result.criteria.deployable_alone).toBe(true);
    });
  });

  describe("overall validation", () => {
    it("should return valid: true when all criteria pass", () => {
      const result = validateSplitCriteria({
        title: "User profile editing",
        text: "As a user, I want to edit my profile so that I can update my information",
        descriptionStructured: [{ role: "user", goal: "edit profile", benefit: "update information" }],
        devPoints: 2
      });
      expect(result.valid).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.criteria.independently_valuable).toBe(true);
      expect(result.criteria.deployable_alone).toBe(true);
      expect(result.criteria.completable_in_3_days).toBe(true);
      expect(result.criteria.is_vertical).toBe(true);
    });

    it("should collect multiple failures", () => {
      const result = validateSplitCriteria({
        title: "Implement only the API - part 1 of 2",
        text: "Part 1 of 2: implement only the API endpoint",
        devPoints: 5
      });
      expect(result.valid).toBe(false);
      expect(result.failures.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("store: addSplittingMetadata", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kj-split-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should store splitting metadata on a story", async () => {
    const batch = await createHuBatch("split-test-1", [
      { text: "Original large story" }
    ]);
    const storyId = batch.stories[0].id;

    const metadata = {
      original_hu_id: null,
      split_children: ["HU-child-1", "HU-child-2"],
      indicators_detected: ["multiple_roles", "large_acceptance_criteria"],
      heuristic_applied: "splitting-detector-v1",
      split_confirmed_by_fde: true,
      validation: { valid: true, criteria: {}, failures: [] }
    };

    const updated = addSplittingMetadata(batch, storyId, metadata);
    expect(updated.splitting).toBeDefined();
    expect(updated.splitting.split_children).toEqual(["HU-child-1", "HU-child-2"]);
    expect(updated.splitting.indicators_detected).toEqual(["multiple_roles", "large_acceptance_criteria"]);
    expect(updated.splitting.split_confirmed_by_fde).toBe(true);
  });

  it("should throw for unknown story id", () => {
    const batch = { stories: [{ id: "HU-1", text: "test" }] };
    expect(() => addSplittingMetadata(batch, "HU-999", {})).toThrow("Story HU-999 not found");
  });

  it("should merge metadata with existing splitting field", async () => {
    const batch = await createHuBatch("split-test-2", [
      { text: "Story with existing metadata" }
    ]);
    const storyId = batch.stories[0].id;

    addSplittingMetadata(batch, storyId, { original_hu_id: "HU-parent" });
    addSplittingMetadata(batch, storyId, { split_confirmed_by_fde: true });

    expect(batch.stories[0].splitting.original_hu_id).toBe("HU-parent");
    expect(batch.stories[0].splitting.split_confirmed_by_fde).toBe(true);
  });

  it("should roundtrip splitting metadata through save/load", async () => {
    const sessionId = "split-roundtrip";
    const batch = await createHuBatch(sessionId, [
      { text: "Story for roundtrip test" }
    ]);
    const storyId = batch.stories[0].id;

    addSplittingMetadata(batch, storyId, {
      original_hu_id: "HU-parent-42",
      split_children: ["HU-c1", "HU-c2"],
      indicators_detected: ["conjunctions"],
      heuristic_applied: "detector-v1",
      split_confirmed_by_fde: false,
      validation: { valid: true, criteria: { is_vertical: true }, failures: [] }
    });

    await saveHuBatch(sessionId, batch);
    const loaded = await loadHuBatch(sessionId);

    const story = loaded.stories.find(s => s.id === storyId);
    expect(story.splitting).toBeDefined();
    expect(story.splitting.original_hu_id).toBe("HU-parent-42");
    expect(story.splitting.split_children).toEqual(["HU-c1", "HU-c2"]);
    expect(story.splitting.validation.valid).toBe(true);
    expect(story.splitting.split_confirmed_by_fde).toBe(false);
  });
});
