#!/usr/bin/env node
// kj sentinel state writer (KJC-TSK-0713) — managed by `kj harden`.
// Records deterministic method facts per session; never blocks, never fails
// a tool call (PostToolUse, always exit 0).
import console from "node:console";
import process from "node:process";
import { realpathSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { CODE, TESTS, ROOT, CARD, branchOf, enterLane, laneTop, load, save, session } from "./sentinel-lib.mjs";
import { remindersFor } from "./sentinel-reminders.mjs";
let raw = "";
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", () => {
  try {
    const { session_id: sid = "default", tool_name: tool, tool_input: input = {}, tool_response: response = {}, cwd = null } = JSON.parse(raw);
    enterLane(cwd, sid);
    // KJC-TSK-0765 board-sync: a merge that gh CONFIRMS leaves its card pending
    // in the tracker (the PreToolUse gate then refuses to advance until it is
    // moved). Recorded here, after the fact, so a failed merge never blocks.
    const text = typeof response === "string" ? response : JSON.stringify(response);
    // Closing states that count as "registered in the tracker" (PG statuses and
    // HU Board moves). The pending entry is cleared by the REAL tool call that
    // moved the card — never by a promise in the agent's prose.
    const CLOSING = ["to validate", "to-validate", "fixed", "verified", "closed", "done", "done&validated", "validated"];
    const clearPending = (cardId) => {
      const state = load();
      const s = session(state, sid);
      s.pending_moves = (s.pending_moves || []).filter((p) => p.card !== null && p.card !== cardId);
      // KJC-TSK-0774: a card closed this turn is what the Stop hook points the
      // user at when the focus comes back (the board is where to look).
      if (cardId && !(s.closed_cards ||= []).includes(cardId)) s.closed_cards.push(cardId);
      save(state);
    };
    // KJC-TSK-0847 (ADR 0010, RAG-A): the ledger of what the RAG answered in
    // this session — every kj_rag_query (MCP) and kj rag query (CLI) with the
    // repo-relative sources it returned. Neither the CLI nor the MCP know the
    // host's session id: the harness records, they do not. Hits outside the
    // repo (another indexed project) are not ours and are dropped.
    // KJC-BUG-0190: an index with nothing in it (a brand new project) answers
    // every question with silence, so the gate would demand what no query can
    // deliver. kj says so explicitly, in both its human and json forms.
    const EMPTY_INDEX = /No chunks indexed yet|"empty"\s*:\s*true/;
    // KJC-BUG-0293 (#1996, #1995): the index names its sources through whatever
    // spelling of the project directory indexed them (a symlinked workspace, an
    // alias). Compared as TEXT against the harness root, every hit fell outside
    // the tree and was dropped in silence: rag_hits stayed empty and only new
    // files passed. Both sides are compared by REAL path, and what still falls
    // outside is written down for the gate to name.
    // A path whose file is gone (or not yet there) resolves through its deepest
    // existing ancestor, so an alias of the directory still lands in the tree.
    const realOf = (p) => {
      try { return realpathSync(p); } catch { /* resolve the parent instead */ }
      const d = dirname(p);
      return !d || d === p ? p : join(realOf(d), basename(p));
    };
    const ROOT_REAL = realOf(ROOT);
    const recordRag = (query, sources, answer = "") => {
      const state = load();
      const s = session(state, sid);
      s.at = Date.now();
      if (EMPTY_INDEX.test(String(answer))) s.rag_index_empty = true;
      const hits = [];
      const dropped = [];
      for (const src of sources) {
        const rel = relative(ROOT_REAL, realOf(String(src))).split(String.fromCharCode(92)).join("/");
        if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("/")) { dropped.push(String(src)); continue; }
        if (!hits.includes(rel)) hits.push(rel);
      }
      (s.rag_queries ||= []).push({ ts: Date.now(), text: String(query || "").slice(0, 200), hits });
      const all = (s.rag_hits ||= []);
      for (const h of hits) if (!all.includes(h)) all.push(h);
      if (hits.length === 0 && dropped.length > 0) s.rag_dropped = { root: ROOT_REAL, count: dropped.length, sample: dropped.slice(0, 3) };
      else if (hits.length > 0) delete s.rag_dropped; // an answer inside the tree ends the diagnosis
      save(state);
    };
    // Sources are read STRUCTURALLY, never through the stringified response:
    // a JSON document (the MCP {content:[{text}]} parts, the CLI --json array)
    // is parsed and its hits[].source / [].source collected.
    const sourcesOf = (doc) => {
      const list = Array.isArray(doc) ? doc : Array.isArray(doc?.hits) ? doc.hits : [];
      return list.map((h) => h?.source).filter((x) => typeof x === "string");
    };
    const parseJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
    if (/__kj_rag_query$/.test(String(tool)) && /^mcp__/.test(String(tool))) {
      // KJC-BUG-0293: the host may hand the answer as {content:[parts]}, as the
      // bare array of parts, or as the text itself; all three are the same answer.
      const parts = Array.isArray(response?.content) ? response.content : Array.isArray(response) ? response : [{ text: typeof response === "string" ? response : "" }];
      let found = parts.flatMap((p) => sourcesOf(parseJson(String(p?.text || ""))));
      // KJC-BUG-0365 (#2208): an answer cut short (whole code chunks) is no
      // longer valid JSON, but every "source" it carries still names a hit.
      if (found.length === 0) found = [...text.matchAll(/\\?"source\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)].map((m) => m[1]);
      recordRag(input.text, found, parts.map((p) => String(p?.text || "")).join(String.fromCharCode(10)));
      process.exit(0);
    }
    if (/__update_card$/.test(String(tool)) && /^mcp__/.test(String(tool))) {
      // The MCP response reaches the hook as {content:[{text:"<json>"}]}: once
      // stringified, the inner quotes are ESCAPED — match both forms (found live:
      // the first real update_card did not clear its pending entry).
      const cid = /\\?"cardId\\?"\s*:\s*\\?"([A-Za-z0-9-]+)\\?"/.exec(text);
      const st = /\\?"status\\?"\s*:\s*\\?"([^"\\]+)\\?"/.exec(text);
      if (cid && st && CLOSING.includes(st[1].toLowerCase())) {
        clearPending(cid[1].toUpperCase());
        // KJC-BUG-0157: a pending whose card-id NEVER existed (branch named
        // before the tracker confirmed the create) could not be cleared by any
        // verified route. The pending's TRUE identity is its PR: a CONFIRMED
        // closing update whose request names that PR clears it too — still a
        // real tracker call seen by this hook, never a promise in prose.
        const prIn = Number(input?.updates?.pipelineStatus?.prCreated?.prNumber);
        if (Number.isFinite(prIn) && prIn > 0) {
          const state = load();
          const s = session(state, sid);
          s.pending_moves = (s.pending_moves || []).filter((p) => Number(p.pr) !== prIn);
          save(state);
        }
      }
      process.exit(0);
    }
    if (tool === "Bash") {
      const cmdText = String(input.command || "");
      // CLI form of the ledger: the human output lists one hit per line as
      // "[kind · label · score=…] <path>"; --json prints an array with "source".
      const ragCmd = /kj +rag +query/.exec(cmdText);
      if (ragCmd) {
        const out = typeof response === "string" ? response : String(response.stdout || "") + String(response.stderr || "");
        const fromLines = out.split(String.fromCharCode(10))
          .filter((l) => l.includes("score=") && l.includes("] "))
          .map((l) => l.slice(l.lastIndexOf("] ") + 2).trim())
          .filter(Boolean);
        recordRag(cmdText.slice(ragCmd.index), fromLines.concat(sourcesOf(parseJson(out.trim()))), out);
        process.exit(0);
      }
      // gh prints "merged pull request #N" only on a TTY: under a tool call the
      // success line is ABSENT (found live on the first dogfood merge). The
      // authoritative signal is the PR state itself: one gh pr view per merge.
      const mergeCmd = /\bgh\s+pr\s+merge(\s+(\d+))?/.exec(cmdText);
      const said = /merged pull request #(\d+)/i.exec(text);
      let mergedPr = said ? Number(said[1]) : null;
      // KJC-BUG-0148: the card belongs to the PR's HEAD branch, not to whatever
      // branch the working tree happens to be on (found live: a merge issued
      // from another card's lane pinned the pending move on the wrong card).
      let headRef = null;
      if (mergeCmd || said) {
        const n = said ? said[1] : mergeCmd[2];
        const args = ["pr", "view", ...(n ? [n] : []), "--json", "number,state,headRefName"];
        const r = spawnSync("gh", args, { cwd: ROOT, encoding: "utf8" });
        try {
          const v = JSON.parse(r.status === 0 ? r.stdout : "null");
          if (v && v.state === "MERGED") { mergedPr = Number(v.number); headRef = v.headRefName || null; }
        } catch { /* unknown = not confirmed (or confirmed only by the printed line) */ }
      }
      if (mergedPr !== null) {
        const state = load();
        const s = session(state, sid);
        const ref = CARD.exec(headRef || branchOf() || "");
        // KJC-BUG-0230: una EPICA (…-PCS-…) no tiene estado que mover: el PG
        // la deja en To Do por mas status que reciba y kj hu move no la
        // conoce. Registrarla como pendiente era un bloqueo sin cauce. Se dice
        // en el momento, para que no parezca que el board dejo de mirar.
        const epic = ref && /-PCS-/i.test(ref[0]);
        if (epic) {
          console.error("karajan sentinel: board-sync — la PR #" + mergedPr + " pertenece a la epica " + ref[0].toUpperCase() + ", que no tiene estado que mover: no queda pendiente (su cierre va en la descripcion de la epica)");
        } else {
          (s.pending_moves ||= []).push({ card: ref ? ref[0].toUpperCase() : null, pr: mergedPr, at: Date.now(), ...(headRef ? {} : { head: "unknown" }) });
        }
        save(state);
      }
      const moved = /kj\s+hu\s+move\s+([A-Za-z0-9-]+)\s+([a-z&-]+)/i.exec(String(input.command || ""));
      // "not found" counts as failure (KJC-BUG-0154): a move that moved nothing must not
      // clear a pending — that would discard a LEGITIMATE one without touching the tracker.
      if (moved && CLOSING.includes(moved[2].toLowerCase()) && !/error|fail|not found/i.test(text)) clearPending(moved[1].toUpperCase());
      // KJC-TSK-0917 (ADR 0014): the method's reminders, after the action that precedes
      // the one each rule is about; at most once every 25 Bash actions each. Never a block.
      const st = load();
      const ss = session(st, sid);
      ss.step = (ss.step || 0) + 1;
      const due = remindersFor(cmdText, { seen: ss.reminded || {}, step: ss.step });
      for (const r of due) (ss.reminded ||= {})[r.id] = ss.step;
      save(st);
      if (due.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: due.map((r) => r.say).join(" ") } }));
      process.exit(0);
    }
    const file = input.file_path || input.notebook_path;
    if (!["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool) || !file) process.exit(0);
    const state = load();
    const s = session(state, sid);
    s.at = Date.now();
    const rel = relative(laneTop(), file).replaceAll("\\", "/");
    // KJC-BUG-0279 (#1981): a file outside the repository is not one of its sources.
    const inside = rel && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/");
    const bucket = !inside ? null : TESTS.test(rel) ? s.edited_tests : CODE.test(rel) ? s.edited_sources : null;
    if (bucket && !bucket.includes(rel)) bucket.push(rel);
    // KJC-TSK-0910: the branch size while it is written, with the CI budget
    // (kj pr-size), said once per threshold crossed. Context, never a block.
    let sizeNote = null;
    if (bucket) {
      const ps = spawnSync("kj", ["pr-size", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 5000 });
      let size = null;
      try { size = JSON.parse(String(ps.stdout || "").trim().split(String.fromCharCode(10)).pop()); } catch { size = null; }
      const crossed = size ? [200, 150].find((t) => size.added > t) : undefined;
      if (crossed && (s.size_warned || 0) < crossed) {
        s.size_warned = crossed;
        sizeNote = "karajan sentinel: la rama ya suma " + size.added + " lineas contables (" + size.testAdded + " de tests); " + (crossed >= 200 ? "pasa el limite de 200 del CI: parte antes de seguir" : "pasa de 150: planea la particion ahora, no en el stage");
      }
    }
    const ids = Object.keys(state.sessions);
    if (ids.length > 5) delete state.sessions[ids.sort((a, b) => (state.sessions[a].at || 0) - (state.sessions[b].at || 0))[0]];
    save(state);
    if (sizeNote) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: sizeNote } }));
  } catch { /* fail open — the sentinel never breaks a tool call */ }
  process.exit(0);
});
