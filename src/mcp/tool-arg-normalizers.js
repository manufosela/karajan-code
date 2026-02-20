export function normalizePlanArgs(args = {}) {
  const normalized = { ...args };

  if (!normalized.planner && normalized.coder) {
    normalized.planner = normalized.coder;
  }

  if (!normalized.plannerModel && normalized.coderModel) {
    normalized.plannerModel = normalized.coderModel;
  }

  delete normalized.coder;
  delete normalized.coderModel;

  return normalized;
}
