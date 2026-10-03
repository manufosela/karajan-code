// The method's reminders (KJC-TSK-0917, ADR 0014). An agent reads its rules at
// the start and loses them when the context is compacted; a hook does not forget.
// These are reminders, not gates: never a block. Each comes AFTER the action that
// precedes the one its rule is about (git add before a commit, gh pr create before
// a merge), from PostToolUse: a PreToolUse reminder would need permissionDecision
// "allow", which skips the user's permission prompt. Copied byte for byte into
// .karajan/harness.
import { headIndex, shellSegments } from "./sentinel-shell.mjs";

/** The git or gh subcommand of a simple command, or null: "git commit" -> ["git", "commit"]. */
const verbOf = (words) => {
  const i = headIndex(words, ["git", "gh"]);
  const tool = (words[i] || "").split("/").at(-1);
  if (tool !== "git" && tool !== "gh") return null;
  let j = i + 1;
  while (j < words.length && words[j].startsWith("-")) j += ["-C", "-c", "-R", "--repo"].includes(words[j]) ? 2 : 1;
  return [tool, words[j] || "", words[j + 1] || ""];
};

const REMINDERS = [
  {
    id: "commit",
    when: (verbs) => verbs.some(([t, a]) => t === "git" && a === "add"),
    say: "kj, antes de commitear: cabecera de 100 caracteres como máximo con el sujeto en minúscula, líneas del cuerpo de 100 como máximo y sin atribución a IA. Valida el mensaje con npx commitlint --edit <fichero> y stagea por nombre (nunca git add -A).",
  },
  {
    id: "gh-account",
    when: (verbs) => verbs.some(([t]) => t === "gh") && !verbs.some(([t, a, b]) => t === "gh" && a === "auth" && b === "switch"),
    say: "kj: gh sin cuenta explícita. La cuenta activa puede haberla cambiado otra sesión; antepón gh auth switch --user <cuenta-del-proyecto> && en el mismo comando.",
  },
  {
    id: "merge",
    when: (verbs) => verbs.some(([t, a, b]) => t === "gh" && a === "pr" && b === "create"),
    say: "kj, PR abierta; antes de mergearla: si la card no está terminada, pártela ahora (lo hecho en su card, el resto en una nueva). Tras el merge, muévela con sus commits.",
  },
  {
    id: "sync-main",
    when: (verbs, segs) => segs.some((w) => w.includes("main")) && verbs.some(([t, a]) => t === "git" && ["checkout", "switch", "pull"].includes(a)),
    say: "kj: tras sincronizar main, crea ya la rama de la siguiente tarea desde origin/main. En main nunca se commitea.",
  },
];

/**
 * The reminders due after a Bash command ran, minus those already shown within
 * the last `every` actions.
 * @param {string} cmd
 * @param {{seen?: Record<string, number>, step?: number, every?: number}} [opts]
 *   seen: action number at which each reminder was last shown; step: this action's number.
 * @returns {{id: string, say: string}[]}
 */
export const remindersFor = (cmd, { seen = {}, step = 0, every = 25 } = {}) => {
  const segs = shellSegments(cmd);
  const verbs = segs.map(verbOf).filter(Boolean);
  return REMINDERS.filter((r) => r.when(verbs, segs))
    .filter((r) => !Object.hasOwn(seen, r.id) || step - seen[r.id] > every)
    .map(({ id, say }) => ({ id, say }));
};
