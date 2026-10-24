// KJC-TSK-1183 — `kj doc index <file>` and `kj doc section <file> <heading>`: a long markdown
// document is read by index, the headings first and only the sections a task needs, each one
// whole and exactly as the file has it. The headings are the index; nothing extra to keep in sync.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { indexMarkdown, sectionOf } from "../docs/markdown-index.js";

export function docCommand({ action, file, heading = null, flags = {}, cwd = process.cwd(), out = process.stdout }) {
  if (!file) throw new Error("usage: kj doc index <file> | kj doc section <file> <heading>");
  const path = resolve(cwd, file);
  const text = readFileSync(path, "utf8"); // a missing file fails loud, with the path
  if (action === "index") {
    const headings = indexMarkdown(text);
    if (flags.json) out.write(`${JSON.stringify({ file: path, headings })}\n`);
    else for (const h of headings) out.write(`${"  ".repeat(h.level - 1)}${"#".repeat(h.level)} ${h.title}  (line ${h.line})\n`);
    return headings;
  }
  if (action === "section") {
    if (!heading) throw new Error("usage: kj doc section <file> <heading>");
    const section = sectionOf(text, heading);
    if (flags.json) out.write(`${JSON.stringify({ file: path, ...section })}\n`);
    else out.write(section.text); // exactly as the file has it, nothing added
    return section;
  }
  throw new Error(`unknown action "${action}": use index | section`);
}
