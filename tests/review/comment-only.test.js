// KJC-BUG-0235 (campo, grebla #948/#952): una limpieza borra codigo y corrige
// los comentarios que se quedaban mintiendo. Esas lineas anadidas son
// comentario, no comportamiento. Se decide leyendo el fichero resultante, no
// el prefijo de la linea: "* factor" puede ser la continuacion de un producto.
import { describe, it, expect } from "vitest";

import { addedAreCommentsOnly, codeLines } from "../../src/review/comment-only.js";

describe("codeLines", () => {
  it("un comentario de linea, uno de bloque de varias lineas y blancos no son codigo", () => {
    const src = ["// cabecera", "/**", " * sigue siendo comentario", " */", "", "const a = 1; // con codigo", "  /* solo */  "].join("\n");
    expect([...codeLines(src, "a.js")]).toEqual([6]);
  });

  it("un '*' al principio de linea puede ser codigo (continuacion), y lo es fuera de un comentario", () => {
    const src = ["const t = base", "  * factor;"].join("\n");
    expect([...codeLines(src, "a.js")].sort()).toEqual([1, 2]);
  });

  it("una linea en blanco dentro de un template literal es parte de su valor", () => {
    expect([...codeLines(["const t = `a", "", "b`;"].join("\n"), "a.js")]).toEqual([1, 2, 3]);
  });

  it("un salto de linea escapado dentro de un string sigue siendo string en la linea siguiente", () => {
    const src = ['const s = "a\\', '// no es comentario";', "x();"].join("\n");
    expect([...codeLines(src, "a.js")]).toEqual([1, 2, 3]);
    expect(addedAreCommentsOnly(src, new Set([2]), "a.js")).toBe(false);
  });

  it("un '//' dentro de un string no abre comentario", () => {
    expect([...codeLines('const u = "http://x";', "a.js")]).toEqual([1]);
    expect([...codeLines("const s = `/* no */`;", "a.ts")]).toEqual([1]);
  });

  it("Python: # es comentario; un docstring es un string, cuenta como codigo", () => {
    expect([...codeLines(["# nota", "x = 1", '"""doc"""'].join("\n"), "m.py")]).toEqual([2, 3]);
  });

  it("un lenguaje sin sintaxis conocida no se juzga: todo cuenta como codigo", () => {
    expect(codeLines("# comentario?", "x.unknown")).toBeNull();
  });
});

describe("addedAreCommentsOnly", () => {
  const after = ["// Aqui vivia /dora: se retiro con su pantalla.", "// La clave se queda: la usa Poker.", "export const KEY = 1;"].join("\n");
  it("verdadero si TODAS las lineas anadidas son comentario o blanco", () => {
    expect(addedAreCommentsOnly(after, new Set([1, 2]), "index.js")).toBe(true);
  });
  it("una sola linea de codigo anadida lo hace falso", () => {
    expect(addedAreCommentsOnly(after, new Set([2, 3]), "index.js")).toBe(false);
  });
  it("una regex que parece abrir un comentario no convierte en comentario el codigo de despues", () => {
    const src = ["const r = /a\\/*b/;", "run();"].join("\n");
    expect(addedAreCommentsOnly(src, new Set([2]), "a.js")).toBe(false);
    // Caso de la review: una linea '* factor' tras la regex sigue siendo codigo.
    const product = ["const r = /a\\/*b/, t = base", "  * factor;"].join("\n");
    expect(addedAreCommentsOnly(product, new Set([2]), "a.js")).toBe(false);
    const cls = ["const r = /[/*]/.test(x), t = b", "  * f;"].join("\n");
    expect(addedAreCommentsOnly(cls, new Set([2]), "a.js")).toBe(false);
  });

  it("JSX no se juzga: un '//' en el texto de un elemento se pinta", () => {
    const jsx = ["const App = () => (", "  <p>", "    // se ve en pantalla", "  </p>", ");"].join("\n");
    expect(codeLines(jsx, "App.jsx")).toBeNull();
    expect(codeLines(jsx, "App.js")).toBeNull();
    expect(codeLines(["function A() {", "  return <b>x</b>;", "}"].join("\n"), "a.js")).toBeNull();
    // Una comparacion no es JSX.
    expect(codeLines("for (let i = 0; i<n; i++) {}", "a.js")).not.toBeNull();
  });

  it("shell y Ruby no se juzgan: un '#' dentro de un heredoc es contenido", () => {
    const sh = ["cat <<'EOF'", "# value", "EOF"].join("\n");
    expect(codeLines(sh, "run.sh")).toBeNull();
    expect(addedAreCommentsOnly(sh, new Set([2]), "run.sh")).toBe(false);
  });

  it("una continuacion de bloque sin '*' no se da por comentario: falso negativo aceptado", () => {
    // La marca al principio es la segunda red contra un error del analizador.
    // Criterio pactado: mejor que se escape una limpieza a que se cuele codigo.
    expect(addedAreCommentsOnly(["/* note", "continued", "*/"].join("\n"), new Set([2]), "a.js")).toBe(false);
  });

  it("sin sintaxis conocida, falso: mejor que se escape una limpieza a que se cuele codigo", () => {
    expect(addedAreCommentsOnly("# x", new Set([1]), "a.unknown")).toBe(false);
  });
});
