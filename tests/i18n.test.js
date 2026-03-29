import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectOsLocale, getLanguageInstruction, SUPPORTED_LANGUAGES } from "../src/utils/locale.js";
import { buildCoderPrompt } from "../src/prompts/coder.js";
import { buildHuReviewerPrompt } from "../src/prompts/hu-reviewer.js";

describe("locale detection", () => {
  const originalEnv = {};

  beforeEach(() => {
    for (const key of ["LANG", "LANGUAGE", "LC_ALL", "LC_MESSAGES"]) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ["LANG", "LANGUAGE", "LC_ALL", "LC_MESSAGES"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns 'es' when LANG=es_ES.UTF-8", () => {
    process.env.LANG = "es_ES.UTF-8";
    expect(detectOsLocale()).toBe("es");
  });

  it("returns 'en' when LANG=en_US.UTF-8", () => {
    process.env.LANG = "en_US.UTF-8";
    expect(detectOsLocale()).toBe("en");
  });

  it("returns 'en' as default when no env vars set", () => {
    expect(detectOsLocale()).toBe("en");
  });

  it("falls back to LANGUAGE when LANG is not set", () => {
    process.env.LANGUAGE = "fr_FR.UTF-8";
    expect(detectOsLocale()).toBe("fr");
  });

  it("falls back to LC_ALL when LANG and LANGUAGE are not set", () => {
    process.env.LC_ALL = "de_DE.UTF-8";
    expect(detectOsLocale()).toBe("de");
  });

  it("skips C and POSIX locales", () => {
    process.env.LANG = "C";
    process.env.LANGUAGE = "POSIX";
    process.env.LC_ALL = "es_ES";
    expect(detectOsLocale()).toBe("es");
  });
});

describe("getLanguageInstruction", () => {
  it("returns empty string for 'en'", () => {
    expect(getLanguageInstruction("en")).toBe("");
  });

  it("returns empty string for null/undefined", () => {
    expect(getLanguageInstruction(null)).toBe("");
    expect(getLanguageInstruction(undefined)).toBe("");
  });

  it("returns Spanish instruction for 'es'", () => {
    const instruction = getLanguageInstruction("es");
    expect(instruction).toContain("Spanish");
    expect(instruction).toMatch(/^IMPORTANT:/);
  });

  it("returns generic instruction for unsupported language", () => {
    const instruction = getLanguageInstruction("ja");
    expect(instruction).toContain("ja");
    expect(instruction).toMatch(/^IMPORTANT:/);
  });
});

describe("SUPPORTED_LANGUAGES", () => {
  it("includes en and es", () => {
    expect(SUPPORTED_LANGUAGES.en).toBe("English");
    expect(SUPPORTED_LANGUAGES.es).toBe("Español");
  });
});

describe("config defaults include language", () => {
  it("loadConfig returns language and hu_language", async () => {
    const { loadConfig } = await import("../src/config.js");
    const { config } = await loadConfig();
    expect(config).toHaveProperty("language");
    expect(config).toHaveProperty("hu_language");
  });
});

describe("coder prompt includes language instruction", () => {
  it("includes Spanish instruction when language is 'es'", async () => {
    const prompt = await buildCoderPrompt({
      task: "Fix the bug",
      language: "es"
    });
    expect(prompt).toContain("IMPORTANT: Respond in Spanish");
  });

  it("does not include language instruction when language is 'en'", async () => {
    const prompt = await buildCoderPrompt({
      task: "Fix the bug",
      language: "en"
    });
    expect(prompt).not.toContain("IMPORTANT: Respond in");
  });

  it("does not include language instruction when language is omitted", async () => {
    const prompt = await buildCoderPrompt({
      task: "Fix the bug"
    });
    expect(prompt).not.toContain("IMPORTANT: Respond in");
  });
});

describe("HU reviewer uses hu_language, not language", () => {
  it("includes Spanish instruction when hu_language is 'es'", () => {
    const prompt = buildHuReviewerPrompt({
      stories: [{ id: "HU-001", text: "As a user..." }],
      instructions: null,
      hu_language: "es"
    });
    expect(prompt).toContain("IMPORTANT: Respond in Spanish");
  });

  it("does not include language instruction when hu_language is 'en'", () => {
    const prompt = buildHuReviewerPrompt({
      stories: [{ id: "HU-001", text: "As a user..." }],
      instructions: null,
      hu_language: "en"
    });
    expect(prompt).not.toContain("IMPORTANT: Respond in");
  });

  it("defaults to English when hu_language is omitted", () => {
    const prompt = buildHuReviewerPrompt({
      stories: [{ id: "HU-001", text: "As a user..." }],
      instructions: null
    });
    expect(prompt).not.toContain("IMPORTANT: Respond in");
  });
});
