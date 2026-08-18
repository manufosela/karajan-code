/**
 * Adaptador de excepciones de karajan-code (GOV-A, KJC-TSK-0745). El
 * registro vive en el kernel (@karajan/governance); aquí solo lo que es de
 * este dominio: la identidad (git user + usuario del SO — DECLARADA, no
 * autenticada) y el destino append-only `.karajan/policy-exceptions.jsonl`.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import { recordPolicyException as kernelRecord } from "../../packages/governance/src/exceptions.js";

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
  return kernelRecord({ projectDir, entry, deps: { append, identity } });
}
