import fs from "node:fs/promises";
import { exists } from "../utils/fs.js";
import { getSessionRoot } from "../utils/paths.js";

export async function reportCommand({ list = false }) {
  const dir = getSessionRoot();
  if (!(await exists(dir))) {
    console.log("No reports yet");
    return;
  }

  const entries = await fs.readdir(dir);
  if (list) {
    for (const item of entries) console.log(item);
    return;
  }

  const last = entries.sort().at(-1);
  if (!last) {
    console.log("No reports yet");
    return;
  }

  const content = await fs.readFile(path.join(dir, last, "session.json"), "utf8");
  console.log(content);
}
