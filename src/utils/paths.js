// Shim: paths primitives now live in karajan-core/paths so the
// hu-board workspace can consume them without a relative dep on the
// CLI src tree. KJC-TSK-0511 PR3.
export {
  resolveHome,
  getKarajanHome,
  __resetKjHomeWarningForTests,
  getSessionRoot,
  getSonarComposePath,
  getOllamaComposePath,
  getWebperfDir,
  getPromptsDir,
} from "karajan-core/paths";
