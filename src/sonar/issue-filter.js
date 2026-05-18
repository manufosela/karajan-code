// @deprecated — moved to src/audit/issue-filter.js (v2.17.0). This shim
// re-exports the generalised filter so existing imports keep working. All
// Sonar-specific behaviour (default `tool="sonar"`, legacy
// `// karajan-sonar-ignore: <rule>` markers) is preserved by the new module.
//
// New code should import from "../audit/issue-filter.js" directly.

export {
  filterFalsePositives,
  hasInlineIgnore,
  DEFAULT_FALSE_POSITIVES,
} from "../audit/issue-filter.js";
