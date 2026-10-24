// KJC-TSK-1183: long markdown documents are read by index, headings first and sections on
// demand, each one whole and exactly as it is in the file. The headings are the index: nothing
// extra to keep in sync.
import { describe, expect, it } from "vitest";
import { indexMarkdown, sectionOf, UnknownHeadingError } from "../../src/docs/markdown-index.js";

const DOC = [
  "# Spec",
  "intro",
  "",
  "## Billing ##",
  "b1",
  "```md",
  "# not a heading",
  "## neither",
  "```",
  "### Taxes",
  "t1",
  "~~~",
  "## nor this",
  "~~~",
  "## Shipping",
  "#hashtag is text",
  "s1",
  "",
].join("\n");

describe("indexMarkdown", () => {
  it("lists the headings with their level and line, skipping fenced code and hashtags", () => {
    expect(indexMarkdown(DOC)).toEqual([
      { level: 1, title: "Spec", line: 1 },
      { level: 2, title: "Billing", line: 4 },
      { level: 3, title: "Taxes", line: 10 },
      { level: 2, title: "Shipping", line: 15 },
    ]);
    expect(indexMarkdown("")).toEqual([]);
    expect(indexMarkdown("   ## Indented\n    # code by indentation\n")).toEqual([{ level: 2, title: "Indented", line: 1 }]);
  });

  it("a fence closes only with the same character and a run at least as long, on its own", () => {
    const longer = "````md\n```\n# still code\n````\n# Out\n";
    expect(indexMarkdown(longer)).toEqual([{ level: 1, title: "Out", line: 5 }]);
    const other = "```\n~~~\n# still code\n``` trailing\n# still code too\n```\n# Out\n";
    expect(indexMarkdown(other)).toEqual([{ level: 1, title: "Out", line: 7 }]);
  });
});

describe("sectionOf", () => {
  it("returns the whole section up to the next heading of the same or a higher level, as in the file", () => {
    expect(sectionOf(DOC, "Billing")).toEqual({
      level: 2,
      title: "Billing",
      line: 4,
      text: "## Billing ##\nb1\n```md\n# not a heading\n## neither\n```\n### Taxes\nt1\n~~~\n## nor this\n~~~\n",
    });
    expect(sectionOf(DOC, "Taxes").text).toBe("### Taxes\nt1\n~~~\n## nor this\n~~~\n");
    expect(sectionOf(DOC, "Shipping").text).toBe("## Shipping\n#hashtag is text\ns1\n");
    expect(sectionOf(DOC, "Spec").text).toBe(DOC);
  });

  it("matches exactly first and without case as a fallback, and names the first of duplicates", () => {
    expect(sectionOf(DOC, "shipping").title).toBe("Shipping");
    const twice = "# A\n## Setup\none\n## setup\ntwo\n";
    expect(sectionOf(twice, "setup")).toMatchObject({ line: 4, text: "## setup\ntwo\n" });
    expect(sectionOf(twice, "SETUP")).toMatchObject({ line: 2, duplicates: [4] });
  });

  it("an unknown heading is an explicit error that lists the headings, never an empty section", () => {
    expect(() => sectionOf(DOC, "Refunds")).toThrow(UnknownHeadingError);
    expect(() => sectionOf(DOC, "Refunds")).toThrow(/"Refunds" is not a heading .*Spec, Billing, Taxes, Shipping/);
  });
});
