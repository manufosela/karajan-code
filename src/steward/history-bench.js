/**
 * History bench (HU-3791, issue #3604) — a fixture proves what its author
 * imagined; a real history proves what happened. Runs ONE Steward detector
 * commit by commit over a repository range and says where it FIRST fires and
 * how many commits it fires on. READ-ONLY by construction: every byte comes
 * from `git rev-list` / `git ls-tree` / `git cat-file` — nothing is checked
 * out, no ref or file of the repository is ever written.
 */
import { execFileSync } from "node:child_process";
import { sweepPhantoms } from "./phantom-sweep.js";

/** A detector gets a commit's tree as `{files, read}` and answers whether it fires. */
export const DETECTORS = {
  "phantom-coverage": ({ files, read }) => (sweepPhantoms({ projectDir: "", files, read }).phantoms ?? []).length > 0,
};

const git = (repoDir, args) =>
  execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** @returns {Map<string, string>} path → blob oid for a commit's tree */
function blobsOf(repoDir, sha) {
  const blobs = new Map();
  for (const row of git(repoDir, ["ls-tree", "-r", "-z", sha]).split("\0").filter(Boolean)) {
    const tab = row.indexOf("\t");
    const [, type, oid] = row.slice(0, tab).split(" ");
    if (type === "blob") blobs.set(row.slice(tab + 1), oid);
  }
  return blobs;
}

/**
 * @param {{repoDir: string, range: string, detector: string}} opts range is any
 *   `git rev-list` range (`a..b`, a branch, `HEAD`), read oldest commit first
 * @returns {{detector: string, commits: number, firings: number, firstFiring: {sha: string, index: number}|null}}
 */
export function benchDetector({ repoDir, range, detector }) {
  const detect = DETECTORS[detector];
  if (!detect) throw new Error(`unknown detector "${detector}" — available: ${Object.keys(DETECTORS).join(", ")}`);
  if (!range || range.startsWith("-")) throw new Error(`invalid range "${range}" — pass a commit range such as main..HEAD`);
  const shas = git(repoDir, ["rev-list", "--reverse", range]).split("\n").filter(Boolean);
  const texts = new Map(); // blob oid → text: a file unchanged across commits is read once
  const result = { detector, commits: shas.length, firings: 0, firstFiring: null };
  shas.forEach((sha, index) => {
    const blobs = blobsOf(repoDir, sha);
    const read = (rel) => {
      const oid = blobs.get(rel);
      if (!texts.has(oid)) texts.set(oid, git(repoDir, ["cat-file", "blob", oid]));
      return texts.get(oid);
    };
    if (!detect({ files: [...blobs.keys()], read })) return;
    result.firings += 1;
    result.firstFiring ??= { sha, index };
  });
  return result;
}
