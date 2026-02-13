import { loadConfig } from "../config.js";

export async function configCommand({ json = false }) {
  const { config, path, exists } = await loadConfig();
  if (json) {
    console.log(JSON.stringify({ path, exists, config }, null, 2));
    return;
  }

  console.log(`Config path: ${path}`);
  console.log(`Exists: ${exists}`);
  console.log(JSON.stringify(config, null, 2));
}
