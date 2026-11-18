// HU-4548 — PHP adapter. Detected by composer.json; vendor/ is Composer's
// dependency tree (third-party code, never indexed). Regex chunker, no prepare().
import { chunkPhp } from "./chunk-php.js";

export const PHP_ADAPTER = {
  id: "php",
  extensions: [".php"],
  skipSegments: ["vendor"],
  manifests: ["composer.json"],
  chunkSource: chunkPhp,
};
