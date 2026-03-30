import { describe, it, expect } from "vitest";
import { msg, getLang } from "../src/utils/messages.js";

describe("msg()", () => {
  it("returns Spanish message with interpolation", () => {
    const result = msg("triage_decompose", "es", { count: 5 });
    expect(result).toBe("Triage recomienda descomponer esta tarea en 5 subtareas:");
  });

  it("returns English message with interpolation", () => {
    const result = msg("triage_decompose", "en", { count: 5 });
    expect(result).toBe("Triage recommends decomposing this task into 5 subtasks:");
  });

  it("falls back to English when language is missing", () => {
    const result = msg("solomon_feedback", "fr");
    expect(result).toBe("Reviewer feedback:");
  });

  it("returns key as fallback for unknown keys", () => {
    const result = msg("unknown_key", "es");
    expect(result).toBe("unknown_key");
  });

  it("preserves unreplaced placeholders", () => {
    const result = msg("solomon_conflict", "en", {});
    expect(result).toBe("--- Conflict: {stage} ---");
  });

  it("interpolates Solomon conflict with stage param", () => {
    expect(msg("solomon_conflict", "es", { stage: "reviewer" })).toBe("--- Conflicto: reviewer ---");
  });

  it("interpolates pipeline_iteration", () => {
    expect(msg("pipeline_iteration", "es", { current: 2, max: 5 })).toBe("Iteración 2/5");
    expect(msg("pipeline_iteration", "en", { current: 2, max: 5 })).toBe("Iteration 2/5");
  });

  it("defaults to English when lang is undefined", () => {
    const result = msg("preflight_passed");
    expect(result).toBe("Preflight passed — all checks OK");
  });

  it("returns checkpoint_options in Spanish", () => {
    const result = msg("checkpoint_options", "es");
    expect(result).toContain("Continuar");
    expect(result).toContain("Parar");
  });
});

describe("getLang()", () => {
  it("returns configured language", () => {
    expect(getLang({ language: "es" })).toBe("es");
  });

  it("returns 'en' when language is not set", () => {
    expect(getLang({ })).toBe("en");
  });

  it("returns 'en' when config is null", () => {
    expect(getLang(null)).toBe("en");
  });

  it("returns 'en' when config is undefined", () => {
    expect(getLang(undefined)).toBe("en");
  });

  it("returns 'en' when config has no language field", () => {
    expect(getLang({ someOther: "value" })).toBe("en");
  });
});
