/**
 * Registro de excepciones de policy (PL-B, KJC-TSK-0734) — el modelo
 * probatorio: el valor de una excepción está en QUIÉN la aprobó y con qué
 * contexto, no en la regla que se saltó. Cada entrada liga identidad (git +
 * os, no el proceso), regla exacta, justificación escrita EN el momento y
 * hash del diff afectado — el alcance es ese diff exacto, así que cambiarlo
 * caduca la excepción sola. Append-only: `.karajan/policy-exceptions.jsonl`.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import { spawnSync } from "node:child_process";

function defaultIdentity(projectDir) {
  const git = (args) => spawnSync("git", ["-C", projectDir, "config", ...args], { encoding: "utf8" }).stdout?.trim() || null;
  return { git: `${git(["user.name"]) ?? "?"} <${git(["user.email"]) ?? "?"}>`, os: userInfo().username };
}

function defaultAppend(projectDir, line) {
  const dir = join(projectDir, ".karajan");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "policy-exceptions.jsonl"), line, "utf8");
}

/** @returns {object} the recorded entry (with ts + who resolved). */
export function recordPolicyException({ projectDir, entry, deps = {} }) {
  const { append = defaultAppend, identity = defaultIdentity } = deps;
  const record = { ts: new Date().toISOString(), who: identity(projectDir), ...entry };
  append(projectDir, `${JSON.stringify(record)}\n`);
  return record;
}
