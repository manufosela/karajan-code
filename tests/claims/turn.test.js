// CLM-B (KJC-TSK-0802) — reading one turn out of the transcript: what the AI
// finally SAID, what the user asked, and the tool outputs in between. The shapes
// here are taken from a real Claude Code transcript.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readTurn } from "../../src/claims/turn.js";

let file;
const write = (entries) => { fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n")); return file; };
const user = (text) => ({ type: "user", message: { role: "user", content: text } });
const result = (id, content) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } });
const says = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const thinks = () => ({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "sin datos" }] } });
const uses = (id, cmd) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: cmd } }] } });

beforeEach(() => { file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kj-turn-")), "t.jsonl"); });
afterEach(() => { fs.rmSync(path.dirname(file), { recursive: true, force: true }); });

describe("reading a turn", () => {
  it("takes the final prose, the outputs in between and what the user said", () => {
    write([
      user("publica la 0.3.0"),
      thinks(),
      uses("t1", "npm publish"),
      result("t1", "+ @karajan-family/console@0.3.0"),
      uses("t2", "npm view version"),
      result("t2", "version = '0.3.0'"),
      says("Publicado: 0.3.0, verificado en el registro."),
    ]);
    const turn = readTurn(file);
    expect(turn.text).toBe("Publicado: 0.3.0, verificado en el registro.");
    expect(turn.outputs).toEqual(["+ @karajan-family/console@0.3.0", "version = '0.3.0'"]);
    expect(turn.userSaid).toBe("publica la 0.3.0");
  });

  it("a tool_result is the machine answering, never the user starting a new turn", () => {
    write([
      user("primer encargo"),
      uses("t1", "ls"),
      result("t1", "salida vieja"),
      says("hecho"),
      user("segundo encargo"),
      uses("t2", "ls"),
      result("t2", "salida nueva"),
      says("informe final"),
    ]);
    const turn = readTurn(file);
    expect(turn.userSaid).toBe("segundo encargo");
    expect(turn.outputs).toEqual(["salida nueva"]); // nothing from the previous turn leaks in
    expect(turn.text).toBe("informe final");
  });

  it("thinking and tool_use are not what the AI said: only its prose counts", () => {
    write([user("x"), says("aviso a medias"), uses("t1", "ls"), result("t1", "out"), thinks(), says("informe final")]);
    expect(readTurn(file).text).toBe("informe final");
  });

  it("a half-written line does not throw: a partial transcript is still readable", () => {
    fs.writeFileSync(file, `${JSON.stringify(user("hola"))}\n{"type":"assist`);
    expect(readTurn(file)).toMatchObject({ userSaid: "hola", text: "", outputs: [] });
  });

  it("a transcript with no user message still yields the final text", () => {
    write([says("informe suelto")]);
    expect(readTurn(file)).toMatchObject({ text: "informe suelto", userSaid: "" });
  });
});
