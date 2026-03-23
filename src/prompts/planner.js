function extractStepText(line) {
  const numberedStep = /^\d+[).:-]\s*(.+)$/.exec(line);
  if (numberedStep) return numberedStep[1].trim();
  const bulletStep = /^[-*]\s+(.+)$/.exec(line);
  if (bulletStep) return bulletStep[1].trim();
  return null;
}

function classifyLine(line, state) {
  if (!state.title) {
    const titleMatch = /^title\s*:\s*(.+)$/i.exec(line);
    if (titleMatch) return { type: "title", value: titleMatch[1].trim() };
  }
  if (!state.approach) {
    const approachMatch = /^(approach|strategy)\s*:\s*(.+)$/i.exec(line);
    if (approachMatch) return { type: "approach", value: approachMatch[2].trim() };
  }
  const stepText = extractStepText(line);
  if (stepText) return { type: "step", value: stepText };
  return null;
}

export function parsePlannerOutput(output) {
  const text = String(output || "").trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const state = { title: null, approach: null };
  const steps = [];

  for (const line of lines) {
    const classified = classifyLine(line, state);
    if (!classified) continue;
    if (classified.type === "title") state.title = classified.value;
    else if (classified.type === "approach") state.approach = classified.value;
    else if (classified.type === "step") steps.push(classified.value);
  }

  if (!state.title) {
    const firstFreeLine = lines.find((line) => !/^(approach|strategy)\s*:/i.test(line) && !/^\d+[).:-]\s*/.test(line));
    state.title = firstFreeLine || null;
  }

  return { title: state.title, approach: state.approach, steps };
}

function formatArchitectContext(architectContext) {
  if (!architectContext) return null;
  const arch = architectContext.architecture || {};
  const lines = ["## Architecture Context"];

  if (arch.type) lines.push(`**Type:** ${arch.type}`);
  if (arch.layers?.length) lines.push(`**Layers:** ${arch.layers.join(", ")}`);
  if (arch.patterns?.length) lines.push(`**Patterns:** ${arch.patterns.join(", ")}`);
  if (arch.dataModel?.entities?.length) lines.push(`**Data model entities:** ${arch.dataModel.entities.join(", ")}`);
  if (arch.apiContracts?.length) lines.push(`**API contracts:** ${arch.apiContracts.join(", ")}`);
  if (arch.tradeoffs?.length) lines.push(`**Tradeoffs:** ${arch.tradeoffs.join(", ")}`);
  if (architectContext.summary) lines.push(`**Summary:** ${architectContext.summary}`);

  return lines.length > 1 ? lines.join("\n") : null;
}

export function buildPlannerPrompt({ task, context, architectContext, productContext = null }) {
  const parts = [
    "You are an expert software architect. Create an implementation plan for the following task.",
    "",
    "## Task",
    task,
    ""
  ];

  if (productContext) {
    parts.push("## Product Context", productContext, "");
  }

  if (context) {
    parts.push("## Context", context, "");
  }

  const archSection = formatArchitectContext(architectContext);
  if (archSection) {
    parts.push(archSection, "");
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
