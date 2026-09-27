// KJC-BUG-0226 (issue #1838): el audit listaba issues de OTROS proyectos del
// mismo SonarQube. La causa no era el filtro de la consulta (que existe) sino
// la CLAVE: `resolveSonarProjectKey` miraba los explicitos y, si no habia,
// derivaba una del remote de git, ignorando el `sonar.projectKey` que el repo
// declara en su sonar-project.properties. El scanner SI lo respeta, asi que kj
// escaneaba un proyecto y preguntaba por otro.
//
// El propio codigo ya lo prometia, en scanner.js: "the repo's declared key is
// what the server will know — kj must query THAT". Faltaba cablearlo.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/utils/process.js", () => ({
  runCommand: vi.fn(async () => ({ exitCode: 0, stdout: "git@github.com:owner/other-repo.git\n", stderr: "" })),
}));

import { resolveSonarProjectKey } from "../../src/sonar/project-key.js";

let dir;
const write = (body) => fs.writeFileSync(path.join(dir, "sonar-project.properties"), body);

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kj-key-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("resolveSonarProjectKey y la clave que el repo declara", () => {
  it("usa la clave del sonar-project.properties, que es la que el servidor conoce", async () => {
    write("sonar.projectKey=mi-proyecto-real\nsonar.sources=src\n");
    expect(await resolveSonarProjectKey({}, { cwd: dir })).toBe("mi-proyecto-real");
  });

  it("tolera espacios y comentarios, y no confunde projectName con projectKey", async () => {
    write("# el de verdad\n  sonar.projectKey =  con-espacios  \nsonar.projectName=Otro Nombre\n");
    expect(await resolveSonarProjectKey({}, { cwd: dir })).toBe("con-espacios");
  });

  it("un explicito sigue mandando sobre el fichero: es una decision del usuario", async () => {
    write("sonar.projectKey=del-fichero\n");
    expect(await resolveSonarProjectKey({ sonarqube: { project_key: "de-la-config" } }, { cwd: dir })).toBe("de-la-config");
    expect(await resolveSonarProjectKey({}, { cwd: dir, projectKey: "del-parametro" })).toBe("del-parametro");
  });

  it("sin fichero se sigue derivando del remote, como hasta ahora", async () => {
    const key = await resolveSonarProjectKey({}, { cwd: dir });
    expect(key).toMatch(/^kj-other-repo-[0-9a-f]{12}$/);
  });

  it("un fichero sin projectKey no cuenta: se deriva del remote", async () => {
    write("sonar.sources=src\nsonar.tests=tests\n");
    expect(await resolveSonarProjectKey({}, { cwd: dir })).toMatch(/^kj-other-repo-/);
  });

  // La lectura solo ocurre cuando el caller DICE que directorio le importa.
  // Quien no lo dice se queda exactamente como estaba, que es lo que mantiene
  // el cambio acotado a la consulta, donde esta el bug.
  it("sin cwd explicito no se lee ningun fichero: el comportamiento anterior intacto", async () => {
    write("sonar.projectKey=no-me-mires\n");
    expect(await resolveSonarProjectKey({})).toMatch(/^kj-other-repo-/);
  });
});
