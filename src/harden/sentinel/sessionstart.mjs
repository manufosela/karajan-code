#!/usr/bin/env node
// kj sentinel SessionStart hook (KJC-TSK-0918, ADR 0014), managed by `kj harden`.
// A compaction takes exactly what the agent needs most: the rules it read at the
// start. After a compaction or a resume, this gives them back, short, with the
// state of the session. A new session gets nothing: CLAUDE.md already brings them.
// Copied byte for byte into .karajan/harness; never fails a session (exit 0).
import process from "node:process";
import { CARD, branchOf, load, pendingMoves } from "./sentinel-lib.mjs";

const RULES = [
  "1. Karajan gobierna y se le obedece: no cambies políticas, configuración de gates ni exclusiones para pasar un gate. Si uno parece injusto, díselo a tu usuario o usa kj report-issue.",
  "2. Card antes de código; rama desde origin/main; nunca se commitea en main.",
  "3. kj rag query antes de tocar código que no has consultado en esta sesión.",
  "4. El test que falla va primero; la suite nunca se deja en rojo.",
  "5. kj review --staged antes de cada commit: el veredicto va atado al diff exacto.",
  "6. PR atómica: unas 150 líneas, 200 como máximo; mídela con kj pr-size y parte antes, no en el gate.",
  "7. Conventional Commits, cabecera de 100 caracteres como máximo y sin atribución a IA.",
  "8. Card sin terminar con PR mergeada: pártela antes de mergear; tras el merge, muévela con sus commits.",
  "9. Dentro del repo se escribe solo con Edit/Write; los escapes KJ_ALLOW_* son de tu usuario, no tuyos.",
];

let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { session_id: sid = "default", source } = JSON.parse(raw || "{}");
    if (source !== "compact" && source !== "resume") process.exit(0);
    const branch = branchOf() || "?";
    const card = CARD.exec(branch)?.[0]?.toUpperCase() ?? "ninguna en la rama";
    const pending = pendingMoves(load().sessions?.[sid]).map((p) => `${p.card ?? "?"} (PR #${p.pr})`);
    const state = `Estado: rama ${branch}, card ${card}${pending.length ? `; cards mergeadas sin mover: ${pending.join(", ")}` : ""}.`;
    const context = ["Karajan (reglas que la compactación se lleva):", ...RULES, state].join("\n");
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
  } catch { /* never fails a session */ }
  process.exit(0);
});
