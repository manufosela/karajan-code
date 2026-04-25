import { describe, expect, it } from "vitest";
import { detectSpecSections } from "../src/plan/spec-detector.js";

describe("detectSpecSections", () => {
  it("returns hasSpec=false for empty/null input", () => {
    expect(detectSpecSections("")).toEqual({ hasSpec: false, sections: [], sectionList: [] });
    expect(detectSpecSections(null)).toEqual({ hasSpec: false, sections: [], sectionList: [] });
    expect(detectSpecSections(undefined)).toEqual({ hasSpec: false, sections: [], sectionList: [] });
  });

  it("returns hasSpec=false for plain prose without numbered headings", () => {
    const text = "Add a logout button to the header. It should clear the session cookie.";
    expect(detectSpecSections(text)).toEqual({ hasSpec: false, sections: [], sectionList: [] });
  });

  it("detects numbered ## headings with trailing dot", () => {
    const text = "# Tiny Lib\n\n## 1. Overview\nblah\n\n## 2. Functions\nblah";
    const r = detectSpecSections(text);
    expect(r.hasSpec).toBe(true);
    expect(r.sections).toEqual(["1", "2"]);
    expect(r.sectionList).toEqual([
      { section: "1", title: "Overview" },
      { section: "2", title: "Functions" },
    ]);
  });

  it("detects nested ### headings up to 5 levels deep", () => {
    const text = [
      "## 2. Functions",
      "### 2.1 add",
      "### 2.2 multiply",
      "#### 2.2.1 edge cases",
    ].join("\n");
    const r = detectSpecSections(text);
    expect(r.sections).toEqual(["2", "2.1", "2.2", "2.2.1"]);
    expect(r.sectionList[2]).toEqual({ section: "2.2", title: "multiply" });
  });

  it("recognises §-prefixed headings", () => {
    const text = "## §5 Initial Scope\ncontent\n## §5.1 First Milestone";
    const r = detectSpecSections(text);
    expect(r.sections).toEqual(["5", "5.1"]);
    expect(r.sectionList[1]).toEqual({ section: "5.1", title: "First Milestone" });
  });

  it("ignores prose mentions of section refs", () => {
    const text = [
      "Implement v4.2 of the API.",
      "Reference: see section 7.3 for details.",
      "## 1. Overview",
      "We need to ship 1.0.",
    ].join("\n");
    const r = detectSpecSections(text);
    expect(r.sections).toEqual(["1"]);
  });

  it("dedupes repeated section refs in document order", () => {
    const text = "## 1. First\n## 1. Duplicate ref\n## 2. Second";
    const r = detectSpecSections(text);
    expect(r.sections).toEqual(["1", "2"]);
    expect(r.sectionList[0].title).toBe("First");
  });

  it("handles ) instead of . as separator", () => {
    const text = "## 3) Setup\nblah";
    const r = detectSpecSections(text);
    expect(r.sections).toEqual(["3"]);
    expect(r.sectionList[0].title).toBe("Setup");
  });

  it("ignores bullet-style numbering (not headings)", () => {
    const text = "1. first item\n2. second item";
    expect(detectSpecSections(text).hasSpec).toBe(false);
  });

  it("trims trailing whitespace from titles", () => {
    const text = "## 1. Overview   \n";
    expect(detectSpecSections(text).sectionList[0].title).toBe("Overview");
  });
});
