// KJC-TSK-0437 — `kj ollama [start|stop|status|pull <model>]` subcommand.
// Thin wrappers around src/rag/ollama-manager.js so the user can manage
// the RAG embedder lifecycle without touching docker compose.
import { ollamaUp, ollamaDown, isOllamaReachable, normalizeOllamaConfig } from "../rag/ollama-manager.js";
import { pullOllamaModel } from "../rag/ollama-capability.js";

function embedderCfg(config) {
  return normalizeOllamaConfig(config?.rag?.embedder || {});
}

export async function ollamaStartCommand({ config, logger }) {
  const result = await ollamaUp(config?.rag?.embedder || null);
  if (result.exitCode !== 0) {
    logger.warn(`ollama start failed: ${result.stderr || result.stdout}`);
    return result;
  }
  logger.info(result.reusedHost ? `Reusing Ollama at ${result.reusedHost}` : "Ollama container started.");
  return result;
}

export async function ollamaStopCommand({ config, logger }) {
  const result = await ollamaDown(config?.rag?.embedder || null);
  if (result.exitCode === 0) logger.info(result.stdout || "Ollama stopped.");
  else logger.warn(`ollama stop failed: ${result.stderr || result.stdout}`);
  return result;
}

export async function ollamaStatusCommand({ config, logger }) {
  const cfg = embedderCfg(config);
  const reachable = await isOllamaReachable(cfg.host, cfg.timeouts.healthcheckSeconds);
  const status = { host: cfg.host, container: cfg.containerName, reachable };
  if (reachable) logger.info(`Ollama reachable at ${cfg.host} (container ${cfg.containerName}).`);
  else logger.warn(`Ollama not reachable at ${cfg.host}. Try \`kj ollama start\`.`);
  return status;
}

export async function ollamaPullCommand({ model, config, logger }) {
  if (!model) throw new Error("kj ollama pull: model argument required");
  logger.info(`Pulling ${model} into ${embedderCfg(config).containerName}...`);
  const result = await pullOllamaModel(model, { containerName: embedderCfg(config).containerName });
  if (result.exitCode === 0) logger.info(`  -> ${model} ready.`);
  else logger.warn(`pull ${model} failed: ${result.stderr || result.stdout}`);
  return result;
}
