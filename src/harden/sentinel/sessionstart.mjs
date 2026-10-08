#!/usr/bin/env node
// kj sentinel SessionStart hook (KJC-TSK-0918, ADR 0014), managed by `kj harden`.
// A compaction takes exactly what the agent needs most: the rules it read at the
// start. After a compaction or a resume, this gives them back, short, with the
// state of the session. A new session gets no rules: CLAUDE.md already brings them.
// Copied byte for byte into .karajan/harness; never fails a session (exit 0).
import process from "node:process";
import { spawnSync } from "node:child_process";
import { CARD, ROOT, branchOf, load, pendingMoves } from "./sentinel-lib.mjs";
import { rulesDriftNotice } from "./sentinel-rules.mjs";

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
    // KJC-TSK-0949: an MD changed and its compiled rules fell behind. Said at
    // every start, a new session included: that one gets this line and nothing else.
    const drift = rulesDriftNotice({ root: ROOT, run: spawnSync });
    const lines = [];
    if (source === "compact" || source === "resume") {
      const branch = branchOf() || "?";
      const card = CARD.exec(branch)?.[0]?.toUpperCase() ?? "ninguna en la rama";
      const pending = pendingMoves(load().sessions?.[sid]).map((p) => `${p.card ?? "?"} (PR #${p.pr})`);
      const unmoved = pending.length ? "; cards mergeadas sin mover: " + pending.join(", ") : "";
      lines.push("Karajan (reglas que la compactación se lleva):", ...RULES, `Estado: rama ${branch}, card ${card}${unmoved}.`);
    }
    if (drift) lines.push(`Karajan: ${drift}`);
    // KJC-TSK-0986 (HUM-F, ADR 0018): once per kj version, the invitation to
    // enroll the phone when none is; kj decides and remembers, the hook relays.
    const invite = spawnSync("kj", ["identity", "phone-invite"], { encoding: "utf8", timeout: 8000 });
    const inviteText = invite.status === 0 ? String(invite.stdout || "").trim() : "";
    if (inviteText) lines.push(`Karajan: ${inviteText}`);
    if (lines.length === 0) process.exit(0);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } }));
  } catch { /* never fails a session */ }
  process.exit(0);
});
