/**
 * kj handoff add|list|show (KJC-TSK-0968, HUM-E, ADR 0018): the agent registers
 * what a gate denied it, with the gate's why; the human reads it by id.
 */
import { addHandoff, listHandoffs, readHandoff } from "../harden/handoff.js";

const line = (h) => `${h.id}  ${h.status.padEnd(8)}  ${h.createdAt}  ${h.command}`;

/** @returns {Promise<0|1>} */
export async function handoffCommand({ action = "list", config, flags = {}, log = console.log }) {
  const projectDir = config?.projectDir || process.cwd();
  try {
    if (action === "add") {
      const record = addHandoff({ projectDir, command: flags.command, cwd: flags.cwd ?? projectDir });
      log(`encargo ${record.id} registrado: ${record.command}`);
      log(`por qué lo negó el gate (${record.denial.at}):\n${record.denial.why}`);
      log(`tu usuario lo revisa con kj handoff show ${record.id}; nadie copia y pega el comando.`);
      return 0;
    }
    if (action === "show") {
      const h = readHandoff({ projectDir, id: flags.id });
      if (flags.json) { log(JSON.stringify(h)); return 0; }
      log(`encargo   ${h.id} (${h.status}, ${h.createdAt})`);
      log(`comando   ${h.command}`);
      log(`sha256    ${h.sha256}`);
      log(`cwd       ${h.cwd}`);
      log(`gate      ${h.denial.tool} negó el ${h.denial.at}:\n${h.denial.why}`);
      return 0;
    }
    const all = listHandoffs({ projectDir });
    if (all.length === 0) log("kj handoff: ningún encargo registrado");
    for (const h of all) log(line(h));
    return 0;
  } catch (err) {
    log(err.message);
    return 1;
  }
}
