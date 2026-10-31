/**
 * HU-2792: two branches can add `.karajan/adrs/0037-a.md` and `0037-b.md` in
 * parallel: the names differ, so git sees no conflict and both land with the
 * same number. CI judges a PR that adds an ADR whose number the base already
 * holds under another name (unless the same diff deletes that one: a rename).
 */
export const ADR_RULE = "defaults.adr.number";
const ADR_DIR = ".karajan/adrs/";
const ADR = /^\.karajan\/adrs\/(\d{4})-[^/]*\.md$/;
const lines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);
const numberOf = (file) => Number(ADR.exec(file)[1]);

/**
 * @param {{files: string[], range: string|null, run: (args: string[]) => Promise<string>}} opts
 * @returns {Promise<object|null>} the violation, or null when no added ADR collides with the base
 */
export async function adrNumberViolation({ files, range, run }) {
  if (!files.some((f) => ADR.test(f))) return null;
  const baseRef = range ? range.split(/\.{2,3}/)[0] : "HEAD";
  const changes = lines(await run(["diff", "--no-renames", "--name-status", ...(range ? ["--end-of-options", range] : ["--cached"])])).map((l) => l.split("\t"));
  const added = changes.filter(([status, file]) => status === "A" && ADR.test(file)).map(([, file]) => file);
  const deleted = new Set(changes.filter(([status]) => status === "D").map(([, file]) => file));
  const onBase = lines(await run(["ls-tree", "--name-only", "--end-of-options", baseRef, ADR_DIR])).filter((f) => ADR.test(f));
  for (const file of added) {
    const clash = onBase.find((f) => f !== file && numberOf(f) === numberOf(file) && !deleted.has(f));
    if (!clash) continue;
    const next = String(Math.max(...onBase.map(numberOf), ...added.map(numberOf)) + 1).padStart(4, "0");
    return { rule_id: ADR_RULE, enforcement: "deny", file, reason: `${file} reuses the ADR number of ${clash}, which the base already has; the next free number is ${next}` };
  }
  return null;
}
