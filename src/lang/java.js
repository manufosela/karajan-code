// KJC-PCS-0052 PR-B.2.5 — Java adapter. Detección por pom.xml / build.gradle
// (Maven, Gradle Groovy y Kotlin DSL). target/ y build/ son outputs estándar
// de ambos sistemas; .gradle/ es el cache del wrapper; out/ lo usan IDEs
// (IntelliJ/Eclipse) para classes. chunk-java usa AST (tree-sitter) cuando
// el caller hizo `await prepareJava()` y cae a regex en otro caso (mismo
// patrón que GO_ADAPTER / RUST_ADAPTER / PYTHON_ADAPTER).
import { chunkJava, prepareJava } from "./chunk-java.js";

export const JAVA_ADAPTER = {
  id: "java",
  extensions: [".java"],
  skipSegments: ["target", "build", ".gradle", "out"],
  manifests: ["pom.xml", "build.gradle", "build.gradle.kts"],
  chunkSource: chunkJava,
  prepare: prepareJava,
};
