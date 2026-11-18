// HU-4546 — Kotlin adapter. .gradle is the wrapper cache and .kotlin the
// compiler session dir; build/ is already a common skip segment.
import { chunkKotlin } from "./chunk-kotlin.js";

export const KOTLIN_ADAPTER = {
  id: "kotlin",
  extensions: [".kt", ".kts"],
  skipSegments: [".gradle", ".kotlin"],
  manifests: ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
  chunkSource: chunkKotlin,
};
