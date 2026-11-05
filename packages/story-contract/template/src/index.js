import { createTemplateManager } from "./manager.js";

export { createTemplateManager };
/**
 * The uniform entry of a manager package: `config` is your block of board.yml, `env` the environment
 * (credentials are read from it, never from config), `run` an injectable command runner.
 * The template reads none of them: `client` is for tests; a real package builds its client from `config` and `env`.
 */
export const createManager = ({ client }) => {
  if (!client) throw new Error("template: build your service client here from config and env");
  return createTemplateManager({ client });
};
