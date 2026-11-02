// HU-3278: the one `rag:` line of `kj worktree start`. A seed behind the lane's HEAD starts the delta in the background.
import { startDeltaIndex } from "./bootstrap-index.js";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Never throws on a failed spawn: the lane continues and the line says so. */
export async function catchUpLine({ laneDir, seed, git, start = startDeltaIndex }) {
  if (!seed.seeded) return `rag: not seeded (${seed.reason}) — the first query indexes this lane in the background`;
  const line = `rag: index seeded from main (${seed.chunks} chunks @ ${seed.commit.slice(0, 7)})`;
  const commits = Number((await git(["rev-list", "--count", `${seed.commit}..HEAD`], laneDir)).stdout);
  if (!(commits > 0)) return line;
  const files = (await git(["diff", "--name-only", seed.commit, "HEAD"], laneDir)).stdout.split("\n").filter(Boolean).length;
  const delta = `${plural(commits, "commit")} and ${plural(files, "file")}`;
  let res;
  try { res = start(laneDir); } catch (err) { res = { started: false, error: err.message }; }
  if (res.started) return `${line}; catching up ${delta} in the background`;
  const why = res.busy ? "another indexer is running" : res.error ?? "a recent attempt is on record";
  return `${line}; catch-up of ${delta} not started (${why}); kj rag index --since auto catches up`;
}
