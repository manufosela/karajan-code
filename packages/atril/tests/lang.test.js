// HU-2781 (ADR 0039, decisions 1 and 3): a deterministic check for text that is not English.
import { describe, expect, it } from "vitest";
import { looksNonEnglish, nonEnglishFields, warnIfNonEnglish } from "../src/lang.js";

describe("looksNonEnglish", () => {
  it.each(["búsqueda de pruebas", "añadir tests", "¿cómo testear?", "pruebas para el login", "PARA LA API"])("is true for %j", (text) => {
    expect(looksNonEnglish(text)).toBe(true);
  });
  it.each(["red green refactor", "tdd review", "a guide to testing", "no-op", "", "café", "ES2025 modules", "en-US locale", "de-duplicate", "y-axis"])("is false for %j", (text) => {
    expect(looksNonEnglish(text)).toBe(false);
  });
});

describe("nonEnglishFields", () => {
  const spanish = { description: "Escribe la prueba primero", atril: {} };
  it("names the Spanish description and the Spanish keywords", () => {
    expect(nonEnglishFields(spanish)).toEqual(["description"]);
    expect(nonEnglishFields({ description: "Write it", atril: { keywords: ["prueba", "para"] } })).toEqual(["keywords"]);
    expect(nonEnglishFields({ ...spanish, atril: { keywords: ["para"] } })).toEqual(["description", "keywords"]);
  });
  it("is empty with an English description in atril.en, and ignores keywords that are not strings", () => {
    expect(nonEnglishFields({ ...spanish, atril: { en: { description: "Write the test first" } } })).toEqual([]);
    expect(nonEnglishFields({ description: "Write it", atril: { keywords: [1, null], en: { description: "" } } })).toEqual([]);
  });
});

describe("warnIfNonEnglish", () => {
  it("names the artifact and its fields, and stays silent for English", () => {
    const warnings = [];
    warnIfNonEnglish({ kind: "skill", name: "tdd", description: "Escribe la prueba", atril: { keywords: ["para"] } }, (text) => warnings.push(text));
    warnIfNonEnglish({ kind: "skill", name: "ok", description: "Write the test", atril: {} }, (text) => warnings.push(text));
    expect(warnings).toEqual(["skill:tdd: description and keywords look(s) non-English; atril indexes in English (ADR 0039): add an English description and keywords, or let kj write them with its enricher"]);
  });
});
