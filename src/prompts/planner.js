export function buildPlannerPrompt({ task, context }) {
  const parts = [
    "You are an expert software architect. Create an implementation plan for the following task.",
    "",
    "## Task",
    task,
    ""
  ];

  if (context) {
    parts.push("## Context", context, "");
  }

  parts.push(
    "## Output format",
    "Respond with a JSON object containing:",
    "- `approach`: A concise paragraph describing the overall strategy",
    "- `steps`: An array of objects, each with `description` (what to do) and `commit` (conventional commit message). Each step should correspond to a single commit.",
    "- `risks`: An array of strings describing potential risks or challenges",
    "- `outOfScope`: An array of strings listing what is explicitly NOT included",
    "",
    "Respond ONLY with valid JSON, no markdown fences or extra text."
  );

  return parts.join("\n");
}
