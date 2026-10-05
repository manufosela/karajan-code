// KJC-TSK-0937 (MDR-A, ADR 0016): every rule written in the governing MD files,
// with a stable id, its literal text and where it lives.
import { describe, it, expect } from "vitest";
import { extractRules } from "../../src/rules/inventory.js";

describe("extractRules", () => {
  it("takes the lines with a normative marker, outside code blocks, and skips the rest", () => {
    const md = [
      "# Reglas",
      "",
      "- **NUNCA** commitear credenciales.",
      "",
      "Texto descriptivo sin norma.",
      "",
      "- Sprints: uno por día, SIEMPRE con startDate.",
      "```sh",
      "# never run this in prod",
      "```",
      "* You must stage files by name.",
      "| a | b |",
    ].join("\n");
    const rules = extractRules(md, "CLAUDE.md");
    expect(rules.map((r) => r.text)).toEqual([
      "NUNCA commitear credenciales.",
      "Sprints: uno por día, SIEMPRE con startDate.",
      "You must stage files by name.",
    ]);
    expect(rules[0]).toMatchObject({ file: "CLAUDE.md", line: 3 });
    expect(rules[0].id).toMatch(/^R-[0-9a-f]{10}$/);
  });

  // KJC-BUG-0271: a rule is a markdown block, not a physical line. Cut at the
  // line break, the literal text a compiled rule must cite was a fragment.
  it("a rule wrapped over several lines is one rule, whole, at its first line", () => {
    const md = [
      "- The project RAG answers before you assume: `kj rag query`,",
      "  never guess what the codebase does.",
      "- Otra cosa sin norma.",
      "",
      "Un párrafo que empieza sin marcador",
      "y que **nunca** se parte por su salto de línea.",
      "",
      "Párrafo descriptivo.",
    ].join("\n");
    expect(extractRules(md, "a.md").map((r) => [r.line, r.text])).toEqual([
      [1, "The project RAG answers before you assume: kj rag query, never guess what the codebase does."],
      [5, "Un párrafo que empieza sin marcador y que nunca se parte por su salto de línea."],
    ]);
  });

  it("each list item is its own rule; a header, a table or a fence ends the block before it", () => {
    const md = ["- Never A.", "- Always B,", "  with its continuation.", "## Título que nunca es regla", "Never C.", "```", "never code", "```", "| never | table |"].join("\n");
    expect(extractRules(md, "a.md").map((r) => r.text)).toEqual(["Never A.", "Always B, with its continuation.", "Never C."]);
  });

  it("an HTML comment is not a rule, on one line or on several", () => {
    const md = ["<!-- >>> kj:managed v1 >>> (do not edit: regenerated) -->", "<!--", "never read this", "-->", "- Never D."].join("\n");
    expect(extractRules(md, "a.md").map((r) => r.text)).toEqual(["Never D."]);
  });

  it("skips code fenced with tildes or longer backtick runs, closed only by a matching fence", () => {
    const md = ["~~~", "never inside tildes", "~~~", "````md", "```", "never inside a nested fence", "````", "- Always outside."].join("\n");
    expect(extractRules(md, "x.md").map((r) => r.text)).toEqual(["Always outside."]);
  });

  it("skips a memory file's YAML frontmatter", () => {
    const md = "---\nname: x\ndescription: Never commit to main.\n---\n\nNEVER commit to main.\n";
    expect(extractRules(md, "feedback_x.md").map((r) => r.line)).toEqual([6]);
  });

  it("the id depends on the text, not on its line or its markdown", () => {
    const [a] = extractRules("- **NUNCA** commitear credenciales.", "a.md");
    const [b] = extractRules("\n\n1. NUNCA   commitear `credenciales`.", "b.md");
    expect(a.id).toBe(b.id);
    expect(b.line).toBe(3);
    const ids = ["Never commit to main.", "_Never_ commit to main.", "*Never* commit to main."].map((t) => extractRules(t, "c.md")[0].id);
    expect(new Set(ids).size).toBe(1);
  });

  it("keeps snake_case names, globs (in a code span or not) and what a code span holds", () => {
    const [r] = extractRules("- Never touch `docs/**/*.md` or KJ_ALLOW_X in feedback_x.md.", "a.md");
    expect(r.text).toBe("Never touch docs/**/*.md or KJ_ALLOW_X in feedback_x.md.");
    const [bare] = extractRules("Never edit docs/**/*.md by hand.", "a.md");
    expect(bare.text).toBe("Never edit docs/**/*.md by hand.");
    const [bold] = extractRules("- **NUNCA usar `git add -A`**: stagea por nombre.", "a.md");
    expect(bold.text).toBe("NUNCA usar git add -A: stagea por nombre.");
  });
});
