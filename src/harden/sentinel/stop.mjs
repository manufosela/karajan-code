#!/usr/bin/env node
// kj sentinel stop gate (KJC-TSK-0713) — managed by `kj harden`. Exit 2
// BLOCKS ending the turn while method violations are open (stderr lists each
// one with its remediation). Fails OPEN on corrupt state, git errors, or
// after 3 unresolved blocks — a sentinel bug never bricks the session — and
// the fail-open is recorded in the state. `--status` prints, never blocks.
import console from "node:console";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { doc, load, save, branchOf, enterLane, violations, ROOT } from "./sentinel-lib.mjs";
// KJC-TSK-0774: when the turn ends green with cards closed, remind the user
// where to look — the board URL if it runs (pid file alive), else how to start it.
const boardHint = () => {
  const home = process.env.KARAJAN_HOME || process.env.KJ_HOME || join(homedir(), ".karajan");
  try {
    process.kill(Number(readFileSync(join(home, "hu-board.pid"), "utf8").trim()), 0);
    return "http://localhost:" + (process.env.KJ_BOARD_PORT || "4000") + "/#governance";
  } catch { return "no esta arrancado: kj board start (luego http://localhost:4000/#governance)"; }
};
if (process.argv.includes("--status")) {
  const st = load();
  const branch = branchOf();
  const sessions = Object.entries(st.sessions || {});
  if (!sessions.length) console.log("sentinel: sin actividad registrada en esta sesion");
  for (const [sid, s] of sessions) {
    console.log("session " + sid + ": sources=[" + (s.edited_sources || []).join(", ") + "] tests=[" + (s.edited_tests || []).join(", ") + "] escapes=[" + (s.escapes || []).join(", ") + "] blocks=" + (s.blocks || 0) + ((s.errors || []).length ? " errors=" + s.errors.length : "") + " rag=" + (s.rag_queries || []).length + " queries/" + (s.rag_hits || []).length + " sources");
    for (const x of violations(s, branch)) console.log("  ROJO: " + x);
  }
  process.exit(0);
}
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    if (process.env.KJ_SENTINEL_OFF === "1") process.exit(0);
    const { session_id: sid = "default", transcript_path: transcript = null, cwd = null } = JSON.parse(raw);
    enterLane(cwd, sid);
    const state = load();
    // Tamper check runs regardless of session state: shell indirection leaves
    // no edit-tool record, but it cannot survive `kj sentinel verify`, whose
    // root of trust is the INSTALLED kj package (outside this project tree) —
    // nothing under .karajan can vouch for itself. No kj on PATH → fail open.
    const ver = spawnSync("kj", ["sentinel", "verify", "--json"], { cwd: ROOT, encoding: "utf8" });
    let tampered = [];
    if (!ver.error && ver.status !== null && ver.status !== 0) {
      try { tampered = JSON.parse(ver.stdout).mismatched || ["unknown"]; } catch { tampered = ["unknown"]; }
    }
    if (tampered.length) {
      // KJC-TSK-1205 (ADR 0030): tampering is not a Sentinel failure, so it never
      // fails open; the count stays as a record of how long it went unrestored.
      state.tamper_blocks = (state.tamper_blocks || 0) + 1;
      save(state);
      console.error("karajan sentinel: scripts del supervisor modificados fuera de kj harden (" + tampered.join(", ") + ") — restaura con kj harden antes de terminar; si lo cambiaste tu (humano), reinstalar lo deja en verde." + doc("supervisor"));
      process.exit(2);
    }
    state.tamper_blocks = 0;
    // CLM-B (KJC-TSK-0802, claims-with-evidence ADR): the hard data of the turn's
    // final message, crossed against that turn's outputs. It runs even without a
    // tracked session — a turn with no edits still ends with a final message. The
    // hook carries no policy: kj reads method_gates.claims and answers 0 (off,
    // clean, or warn) or 2 (a datum DENIED by its own source, in block mode). A
    // missing kj or an errored spawn fails open.
    let claimsNote = "";
    let claimsBlock = null;
    if (transcript) {
      const c = spawnSync("kj", ["claims", "gate", "--transcript", transcript], { cwd: ROOT, encoding: "utf8" });
      if (!c.error && c.status === 2) claimsBlock = "claims: un dato del mensaje final esta DESMENTIDO por las salidas de este turno — verificalo o marcalo como no comprobado. Detalle: kj claims check --transcript " + transcript;
      else if (!c.error && c.status === 0 && (c.stderr || "").trim()) claimsNote = "kj claims: " + c.stderr.trim().split(String.fromCharCode(10))[0] + " — datos sin respaldo en este turno (informa, no bloquea).";
    }
    const s = state.sessions?.[sid];
    if (!s) {
      if (claimsBlock) { console.error("karajan sentinel: el turno NO puede terminar:" + String.fromCharCode(10) + "- " + claimsBlock + doc("claims")); process.exit(2); }
      if (claimsNote) console.log(JSON.stringify({ systemMessage: claimsNote }));
      process.exit(0);
    }
    // KJC-TSK-0868: si el anfitrion ha escrito codigo teniendo otro coder
    // declarado, eso no se bloquea, se REGISTRA: el usuario eligio quien
    // escribe y merece enterarse por el decision log, no por casualidad. Una
    // vez por sesion, y si kj no responde se reintenta en el turno siguiente.
    if (!s.panel_sealed && (s.edited_sources || []).length > 0) {
      const p = spawnSync("kj", ["sentinel", "panel-check", "--session", sid], { cwd: ROOT, encoding: "utf8" });
      if (!p.error && p.status === 0) {
        s.panel_sealed = true;
        save(state);
        if ((p.stdout || "").trim()) console.error(p.stdout.trim());
      }
    }
    const v = violations(s, branchOf());
    if (claimsBlock) v.push(claimsBlock);
    if (!v.length) {
      s.blocks = 0;
      const notes = [];
      if (claimsNote) notes.push(claimsNote);
      if ((s.closed_cards || []).length) {
        notes.push("karajan sentinel: card(s) cerrada(s) en este turno: " + s.closed_cards.join(", ") + " — el board las muestra: " + boardHint());
        s.closed_cards = [];
      }
      save(state);
      if (notes.length) console.log(JSON.stringify({ systemMessage: notes.join("\n") }));
      process.exit(0);
    }
    s.blocks = (s.blocks || 0) + 1;
    if (s.blocks > 3) {
      (s.errors ||= []).push("fail-open: 3 bloqueos consecutivos sin resolver — el sentinel se aparta para no colgar la sesion");
      save(state);
      console.error("karajan sentinel: fail-open tras 3 bloqueos sin resolver — revisa kj sentinel status con tu usuario" + doc("stop-gate"));
      process.exit(0);
    }
    save(state);
    console.error("karajan sentinel: el turno NO puede terminar con el metodo en rojo:\n" + v.map((x) => "- " + x).join("\n") + "\nResuelve las violaciones (o pide a tu usuario el escape) y termina de nuevo. Estado: kj sentinel status" + doc("stop-gate"));
    process.exit(2);
  } catch { /* fail open */ }
  process.exit(0);
});
