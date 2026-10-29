// HU-2729 (ADR 0038, layer 1): one fold() shared by search and enrich.
import { describe, expect, it } from "vitest";
import { fold } from "../src/text.js";

describe("fold", () => {
  it("lowercases", () => {
    expect(fold("TDD Review")).toBe("tdd review");
  });
  it("strips accents", () => {
    expect(fold("búsqueda")).toBe("busqueda");
    expect(fold("Canción Über")).toBe("cancion uber");
  });
  it("folds ñ to n like any other combining mark", () => {
    expect(fold("año")).toBe("ano");
    expect(fold("AÑO")).toBe(fold("ano"));
  });
  it("leaves ASCII untouched", () => {
    expect(fold("red-green refactor 42")).toBe("red-green refactor 42");
  });
});
