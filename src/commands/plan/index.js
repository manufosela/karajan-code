// Barrel: re-export all plan sub-command handlers.
import { planGenerateCommand } from "./generate.js";

export { planGenerateCommand } from "./generate.js";
export { planListCommand } from "./list.js";
export { planShowCommand } from "./show.js";
export { planReadyCommand } from "./ready.js";
export { planValidateCommand } from "./validate.js";
export { planDeleteCommand } from "./delete.js";
export { planAddHuCommand } from "./add-hu.js";
export { planRemoveHuCommand } from "./remove-hu.js";
export { planMigrateResultCommand } from "./migrate-result.js";
export { planFixCommand } from "./fix.js";

// Keep backward compat — old callers import planCommand
export const planCommand = planGenerateCommand;
