// KJC-PCS-0052 PR-B.2.3 — Go adapter. Detección por go.mod/go.sum; vendor/
// y bin/ no se recorren (vendor lo usa `go mod vendor`, bin son builds).
// chunk-go usa AST (tree-sitter) cuando el caller hizo `await prepareGo()`
// y cae a regex en otro caso (mismo patrón que PYTHON_ADAPTER / RUST_ADAPTER).
import { chunkGo, prepareGo } from "./chunk-go.js";

export const GO_ADAPTER = {
  id: "go",
  extensions: [".go"],
  skipSegments: ["vendor", "bin"],
  manifests: ["go.mod", "go.sum"],
  chunkSource: chunkGo,
  prepare: prepareGo,
};
