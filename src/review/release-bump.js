/**
 * HU-3812 (issue #3763): is the staged change ONLY a release bump? The version
 * of package.json (and of package-lock.json) moves and CHANGELOG.md may change;
 * anything else, an added/deleted/renamed file or unparsable JSON is not a bump.
 * Pure: the caller injects how to read a file at HEAD and in the index.
 */
import { isDeepStrictEqual } from "node:util";

const CHANGELOG = "CHANGELOG.md";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const withoutVersion = (obj) => ({ ...obj, version: undefined });
const withoutLockVersions = (lock) => (isObject(lock.packages?.[""])
  ? { ...withoutVersion(lock), packages: { ...lock.packages, "": withoutVersion(lock.packages[""]) } }
  : withoutVersion(lock));
/** Each version file and what its comparison ignores. */
const VERSION_FILES = new Map([["package.json", withoutVersion], ["package-lock.json", withoutLockVersions]]);

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null; // the caller refuses the bump: unparsable JSON is never a version-only change
  }
}

function versionProblem(strip, head, index) {
  const before = parseObject(head);
  const after = parseObject(index);
  if (!before || !after) return "unparsable JSON";
  if (before.version === after.version) return "version unchanged";
  return isDeepStrictEqual(strip(before), strip(after)) ? null : "changes more than the version";
}

async function fileProblem(file, { readHead, readIndex }) {
  const strip = VERSION_FILES.get(file);
  if (!strip && file !== CHANGELOG) return "not a version or changelog file";
  const [head, index] = await Promise.all([readHead(file), readIndex(file)]);
  if (head === null || index === null) return "added, deleted or renamed";
  return strip ? versionProblem(strip, head, index) : null;
}

/**
 * @param {string[]} files staged paths (renames listed as delete + add)
 * @param {{readHead: (f: string) => Promise<string|null>, readIndex: (f: string) => Promise<string|null>}} readers null = absent
 * @returns {Promise<{bump: boolean, reason: string}>}
 */
export async function checkReleaseBump(files, readers) {
  if (!files.some((f) => VERSION_FILES.has(f))) return { bump: false, reason: "no version file changed" };
  for (const file of files) {
    const problem = await fileProblem(file, readers);
    if (problem) return { bump: false, reason: `${file}: ${problem}` };
  }
  return { bump: true, reason: "version and changelog only" };
}
