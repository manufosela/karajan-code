/**
 * Golden tasks loader (KJC-TSK-0374). Reads + validates JSON files
 * under a directory; aggregates errors; rejects duplicate ids.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { safeParseGoldenTask } from "./schema.js";

export async function loadGoldenTasks(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err) => {
    throw new Error(`golden tasks directory not readable: ${dir} (${err.code || err.message})`);
  });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => path.join(dir, e.name))
    .sort();

  const tasks = [];
  const errors = [];
  const seenIds = new Map();

  for (const filePath of jsonFiles) {
    let raw;
    try {
      const content = await fs.readFile(filePath, "utf8");
      raw = JSON.parse(content);
    } catch (err) {
      errors.push(`${path.basename(filePath)}: invalid JSON (${err.message})`);
      continue;
    }
    const result = safeParseGoldenTask(raw);
    if (!result.ok) {
      const summary = result.issues.map((iss) => `  - ${iss.path || "(root)"}: ${iss.message}`).join("\n");
      errors.push(`${path.basename(filePath)}:\n${summary}`);
      continue;
    }
    const existing = seenIds.get(result.task.id);
    if (existing) {
      errors.push(`${path.basename(filePath)}: duplicate id "${result.task.id}" (also in ${existing})`);
      continue;
    }
    seenIds.set(result.task.id, path.basename(filePath));
    tasks.push(result.task);
  }

  if (errors.length > 0) {
    throw new Error(`golden tasks failed validation:\n${errors.join("\n")}`);
  }

  return { tasks };
}
