import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "../utils/fs.js";

export async function reportCommand({ list = false }) {
  const dir = path.resolve(process.cwd(), ".karajan", "sessions");
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
