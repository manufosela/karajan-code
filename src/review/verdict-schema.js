/**
 * HU-4833 (KJC-TSK-1729, épica KJC-PCS-0113): the reviewer's verdict against the schema its
 * prompt promises (src/prompts/reviewer.js). A verdict that parses as JSON but breaks the shape
 * (a severity nobody defined, a line that is text) must not reach the coder or the commit gate.
 */
const SEVERITIES = ["critical", "high", "medium", "low"];
const CATEGORIES = ["security", "correctness", "performance", "style", "other"];
// kj solomon --finding <id> and kj code --retry address a finding by its id and pass on its fix.
const TEXT_FIELDS = ["id", "description", "suggested_fix"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";

function issueProblems(issue, at) {
  if (!isObject(issue)) return [`${at}: must be an object`];
  const problems = TEXT_FIELDS.filter((field) => !isText(issue[field])).map((field) => `${at}.${field}: must be non-empty text`);
  if (!SEVERITIES.includes(issue.severity)) problems.push(`${at}.severity: must be one of ${SEVERITIES.join("|")}`);
  if (!CATEGORIES.includes(issue.category)) problems.push(`${at}.category: must be one of ${CATEGORIES.join("|")}`);
  if (issue.file != null && typeof issue.file !== "string") problems.push(`${at}.file: must be text or null`);
  if (issue.line != null && !(Number.isInteger(issue.line) && issue.line >= 0)) problems.push(`${at}.line: must be a non-negative integer or null`);
  return problems;
}

/**
 * The ways a parsed verdict breaks its schema, each naming the field; empty when it keeps it.
 * @param {unknown} verdict
 * @returns {string[]}
 */
export function verdictSchemaProblems(verdict) {
  if (!isObject(verdict)) return ["verdict: must be an object"];
  const problems = [];
  if (typeof verdict.approved !== "boolean") problems.push("approved: must be a boolean");
  if (Array.isArray(verdict.blocking_issues)) {
    verdict.blocking_issues.forEach((issue, i) => problems.push(...issueProblems(issue, `blocking_issues[${i}]`)));
  } else {
    problems.push("blocking_issues: must be a list");
  }
  return problems;
}
