/** `kj review --lane <slug>`: the lane's directory, so the gate reviews the diff staged THERE. */
import fs from "node:fs";
import path from "node:path";
import { mainCheckout } from "./main-checkout.js";

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function resolveLaneDir(slug, projectDir = process.cwd()) {
  if (!SLUG.test(slug) || slug.includes("..")) throw new Error(`invalid lane "${slug}": expected a lane slug (see kj worktree list)`);
  const dir = path.join(mainCheckout(projectDir), ".kj", "worktrees", slug);
  if (!fs.existsSync(dir)) throw new Error(`lane "${slug}" not found at ${dir} (see kj worktree list)`);
  return dir;
}
