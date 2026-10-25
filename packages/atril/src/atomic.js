import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";

/** Write through a temp file and a rename, so a reader never sees half a file. */
export function writeAtomic(path, text) {
  // A random name created exclusively: "wx" fails on anything already there, a symlink included.
  const temp = `${path}.${randomUUID()}.tmp`;
  let created = false;
  try {
    writeFileSync(temp, text, { flag: "wx" });
    created = true;
    renameSync(temp, path);
  } catch (err) {
    if (created) rmSync(temp, { force: true });
    throw err;
  }
}
