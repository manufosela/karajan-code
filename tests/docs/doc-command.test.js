// KJC-TSK-1183: `kj doc` reads a markdown file by index for the agent: headings first, one
// section whole on demand, errors that say what is available.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { docCommand } from "../../src/commands/doc.js";

const DOC = "# Spec\nintro\n## Billing\nb1\n### Taxes\nt1\n## Shipping\ns1\n";
let dir, chunks, out;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kj-doc-"));
  writeFileSync(join(dir, "spec.md"), DOC);
  chunks = [];
  out = { write: (s) => chunks.push(s) };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("kj doc index", () => {
  it("prints the headings indented by level with their line, or the JSON index", () => {
    const headings = docCommand({ action: "index", file: "spec.md", cwd: dir, out });
    expect(headings.map((h) => h.title)).toEqual(["Spec", "Billing", "Taxes", "Shipping"]);
    expect(chunks.join("")).toBe("# Spec  (line 1)\n  ## Billing  (line 3)\n    ### Taxes  (line 5)\n  ## Shipping  (line 7)\n");
    chunks.length = 0;
    docCommand({ action: "index", file: join(dir, "spec.md"), flags: { json: true }, out });
    expect(JSON.parse(chunks[0])).toMatchObject({ file: join(dir, "spec.md"), headings: [{ level: 1, title: "Spec", line: 1 }, {}, {}, {}] });
  });
});

describe("kj doc section", () => {
  it("prints the section exactly as the file has it, and the JSON carries the heading's place", () => {
    docCommand({ action: "section", file: "spec.md", heading: "billing", cwd: dir, out });
    expect(chunks.join("")).toBe("## Billing\nb1\n### Taxes\nt1\n");
    chunks.length = 0;
    docCommand({ action: "section", file: "spec.md", heading: "Shipping", flags: { json: true }, cwd: dir, out });
    expect(JSON.parse(chunks[0])).toMatchObject({ level: 2, title: "Shipping", line: 7, text: "## Shipping\ns1\n" });
  });

  it("fails loud: unknown heading with the list, missing heading, missing file, unknown action", () => {
    expect(() => docCommand({ action: "section", file: "spec.md", heading: "Refunds", cwd: dir, out })).toThrow(/"Refunds" is not a heading .*Spec, Billing, Taxes, Shipping/);
    expect(() => docCommand({ action: "section", file: "spec.md", cwd: dir, out })).toThrow(/usage: kj doc section/);
    expect(() => docCommand({ action: "index", file: "missing.md", cwd: dir, out })).toThrow(/ENOENT/);
    expect(() => docCommand({ action: "toc", file: "spec.md", cwd: dir, out })).toThrow(/unknown action "toc"/);
    expect(() => docCommand({ action: "index", cwd: dir, out })).toThrow(/usage: kj doc index/);
    expect(chunks).toEqual([]);
  });
});
