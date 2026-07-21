/**
 * ADRs in the repo (AB-H, KJC-TSK-0658) — `kj adr add|list`. Architecture
 * decisions live as numbered markdown under .karajan/adrs/, git-tracked so
 * the whole team (and every brain) inherits them. The architect brief's
 * "check the ADRs before deciding" now has a target on every backend.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ADR_DIR = path.join(".karajan", "adrs");

const slugify = (t) => t.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").slice(0, 60);

export async function listAdrs(projectDir) {
  const dir = path.join(projectDir, ADR_DIR);
  let files;
  try { files = await fs.readdir(dir); } catch { return []; }
  const adrs = [];
  for (const f of files.filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
    const text = await fs.readFile(path.join(dir, f), "utf8");
    const title = text.match(/^# (.+)$/m)?.[1] || f;
    const status = text.match(/^Status: (.+)$/m)?.[1] || "accepted";
    adrs.push({ file: path.join(ADR_DIR, f), number: Number(f.slice(0, 4)), title, status });
  }
  return adrs;
}

export async function addAdr(projectDir, { title, decision, context = "", consequences = "" }) {
  if (!title?.trim() || !decision?.trim()) {
    throw new Error("kj adr add requires a title and --decision");
  }
  const existing = await listAdrs(projectDir);
  const number = (existing.at(-1)?.number || 0) + 1;
  const file = path.join(ADR_DIR, `${String(number).padStart(4, "0")}-${slugify(title)}.md`);
  const body = [
    `# ${title}`, "",
    `Status: accepted`, `Date: ${new Date().toISOString().slice(0, 10)}`, "",
    ...(context ? ["## Context", "", context, ""] : []),
    "## Decision", "", decision, "",
    ...(consequences ? ["## Consequences", "", consequences, ""] : []),
  ].join("\n");
  await fs.mkdir(path.join(projectDir, ADR_DIR), { recursive: true });
  await fs.writeFile(path.join(projectDir, file), body);
  return { number, file, title };
}
