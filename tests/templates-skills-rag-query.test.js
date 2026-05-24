// KJC-TSK-0433 (Camino B): asegura que el slash command /kj-rag-query
// existe como template y respeta el contrato esperado (texto $ARGUMENTS,
// referencia al CLI `kj rag query`, manejo de empty store).
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.resolve(HERE, "../templates/skills/kj-rag-query.md");

describe("templates/skills/kj-rag-query.md (RAG Camino B)", () => {
  it("exists and is non-empty", async () => {
    const content = await readFile(SKILL_PATH, "utf8");
    expect(content.length).toBeGreaterThan(200);
  });

  it("uses $ARGUMENTS so hosts can inject the user query", async () => {
    const content = await readFile(SKILL_PATH, "utf8");
    expect(content).toContain("$ARGUMENTS");
  });

  it("delegates to the kj rag query CLI", async () => {
    const content = await readFile(SKILL_PATH, "utf8");
    expect(content).toMatch(/kj rag query/);
  });

  it("documents --scope and --top-k flags as passthrough", async () => {
    const content = await readFile(SKILL_PATH, "utf8");
    expect(content).toContain("--scope");
    expect(content).toContain("--top-k");
  });

  it("instructs to handle empty store without blocking", async () => {
    const content = await readFile(SKILL_PATH, "utf8");
    expect(content.toLowerCase()).toMatch(/empty|kj rag index/);
  });
});
