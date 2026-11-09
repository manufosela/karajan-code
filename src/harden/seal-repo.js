// KJC-BUG-0506: the repo a seal is made for, as the phone signs it and the verifier checks it.
// The folder's name was signed before: in a lane it is the lane's, and nothing compared it.
import { execFileSync } from "node:child_process";

const quiet = (cwd) => execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** owner/repo of origin, lower case (GitHub's own comparison); null when there is no origin. */
export function sealRepoOf(projectDir, readOrigin = quiet) {
  let url;
  try { url = readOrigin(projectDir).trim(); } catch { return null; }
  const parts = url.replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/").toLowerCase() : null;
}

/** A repo-named seal must name this repo; one made before names a folder and is not comparable. */
export function sealRepoMismatch({ projectDir, signedProject, readOrigin }) {
  if (typeof signedProject !== "string" || !signedProject.includes("/")) return null;
  const here = sealRepoOf(projectDir, readOrigin);
  return signedProject === here ? null : `se firmó para ${signedProject} y esto es ${here ?? "un repo sin origin"}`;
}
