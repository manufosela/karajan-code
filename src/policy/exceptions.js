/**
 * Adaptador de excepciones de karajan-code (GOV-A, KJC-TSK-0745). El
 * registro vive en el kernel (@karajan-family/governance); aquí solo lo que es de
 * este dominio: la identidad (git user + usuario del SO — DECLARADA, no
 * autenticada) y el destino append-only `.karajan/policy-exceptions.jsonl`.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
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
export function loadStandingExceptions(projectDir) {
  const { records, discarded } = loadExceptionRecords(projectDir);
  return { standing: records.filter((rec) => rec.scopeKind === "permanente"), discarded };
}

/**
 * TODOS los registros del jsonl (permanentes y puntuales) con el mismo parse
 * tolerante — el informe (PL-E) cuenta también las puntuales.
 * @returns {{records: object[], discarded: number}}
 */
export function loadExceptionRecords(projectDir) {
  let raw;
  try {
    raw = readFileSync(join(projectDir, ".karajan", "policy-exceptions.jsonl"), "utf8");
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
      else records.push(rec);
    } catch {
      discarded += 1;
    }
  }
  return { records, discarded };
}

function defaultAppend(projectDir, line) {
  const dir = join(projectDir, ".karajan");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "policy-exceptions.jsonl"), line, "utf8");
}

/** @returns {object} the recorded entry (with ts + who resolved). */
export function recordPolicyException({ projectDir, entry, deps = {} }) {
  const { append = defaultAppend, identity = defaultIdentity } = deps;
  return kernelRecord({ projectDir, entry, deps: { append, identity } });
}
