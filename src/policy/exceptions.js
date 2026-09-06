/**
 * Adaptador de excepciones de karajan-code (GOV-A, KJC-TSK-0745). El
 * registro vive en el kernel (@karajan-family/governance); aquí solo lo que es de
 * este dominio: la identidad (git user + usuario del SO — DECLARADA, no
 * autenticada) y el destino append-only `.karajan/policy-exceptions.jsonl`.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import { recordPolicyException as kernelRecord } from "@karajan-family/governance";

function defaultIdentity(projectDir) {
  const git = (args) => spawnSync("git", ["-C", projectDir, "config", ...args], { encoding: "utf8" }).stdout?.trim() || null;
  // grade DECLARADA: git+os es atribución, no autenticación — el registro
  // no debe venderse como más evidencia de la que es (GOV-B).
  return { git: `${git(["user.name"]) ?? "?"} <${git(["user.email"]) ?? "?"}>`, os: userInfo().username, grade: "declarada" };
}

/**
 * Standing exceptions del dominio code: las permanentes del jsonl. Parse
 * TOLERANTE — una línea corrupta se descarta CONTÁNDOLA (el gate la
 * reporta), jamás rompe la evaluación. Las puntuales no dan standing.
 * @returns {{standing: object[], discarded: number}}
 */
export function loadStandingExceptions(projectDir, { home } = {}) {
  const proj = loadExceptionRecords(projectDir);
  const glob = loadGlobalExceptionRecords({ home });
  return {
    standing: [...proj.records, ...glob.records].filter((rec) => rec.scopeKind === "permanente"),
    discarded: proj.discarded + glob.discarded,
  };
}

/**
 * Ruta del almacén GLOBAL (~/.karajan): excepciones de la máquina, no de un
 * proyecto. `home` es inyectable SOLO para tests.
 */
export const globalExceptionsFile = ({ home } = {}) => join(home ?? homedir(), ".karajan", "policy-exceptions.jsonl");

function readRecordsAt(file, origin) {
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { records: [], discarded: 0 };
  }
  const records = [];
  let discarded = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      // JSON válido pero no-objeto (null, número…) es tan corrupto como el
      // que no parsea: se descarta contando (catch de codex, explícito).
      if (typeof rec !== "object" || rec === null) discarded += 1;
      // Procedencia FÍSICA (KJC-TSK-0813): el origin es el almacén del que
      // se LEYÓ la línea, pisando lo que la línea declare — no se miente.
      else records.push({ ...rec, origin });
    } catch {
      discarded += 1;
    }
  }
  return { records, discarded };
}

/**
 * TODOS los registros del jsonl (permanentes y puntuales) con el mismo parse
 * tolerante — el informe (PL-E) cuenta también las puntuales.
 * @returns {{records: object[], discarded: number}}
 */
export function loadExceptionRecords(projectDir) {
  return readRecordsAt(join(projectDir, ".karajan", "policy-exceptions.jsonl"), "project");
}

/** @returns {{records: object[], discarded: number}} */
export function loadGlobalExceptionRecords({ home } = {}) {
  return readRecordsAt(globalExceptionsFile({ home }), "global");
}

function defaultAppend(projectDir, line) {
  const dir = join(projectDir, ".karajan");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "policy-exceptions.jsonl"), line, "utf8");
}

const globalAppend = (home) => (_projectDir, line) => {
  const dir = join(home ?? homedir(), ".karajan");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "policy-exceptions.jsonl"), line, "utf8");
};

/** @returns {object} the recorded entry (with ts + who resolved). */
export function recordPolicyException({ projectDir, entry, deps = {}, scope = "project" }) {
  if (scope !== "project" && scope !== "global") {
    throw new TypeError(`recordPolicyException: scope "${scope}" no existe — solo project o global`);
  }
  // Un global puntual NO existe: lo puntual liga al hash de un artefacto de
  // UN proyecto; el ámbito global solo admite permanentes con caducidad.
  if (scope === "global" && (entry?.scopeKind !== "permanente" || !entry?.expiresAt)) {
    throw new TypeError("recordPolicyException: el ámbito global exige scopeKind permanente con expiresAt — un global puntual no existe");
  }
  const { home, append = scope === "global" ? globalAppend(home) : defaultAppend, identity = defaultIdentity } = deps;
  // El origin escrito es informativo: la carga re-estampa el FÍSICO igualmente.
  return kernelRecord({ projectDir, entry: { ...entry, origin: scope }, deps: { append, identity } });
}
