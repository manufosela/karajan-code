// KJC-TSK-0414 PR2: registra `kj standby list` + `kj standby resume <id>`.
// `resume` es subcomando de standby para no colisionar con el `kj resume`
// pre-existente (Solomon pauses con --answer). Modelos mentales distintos:
//   - `kj resume <id> --answer X`  → Solomon pauseado (existente)
//   - `kj standby resume <id>`     → run hibernada por quota
import { resumeCommand, standbyListCommand } from "../commands/standby.js";

export function registerStandby(program) {
  const standby = program.command("standby").description("Sesiones hibernadas (QUOTA_EXHAUSTED_DAILY etc.)");
  standby
    .command("list", { isDefault: true })
    .description("Lista sesiones pendientes de reanudar")
    .option("--json", "Output JSON")
    .action(async (flags) => {
      await standbyListCommand({ json: flags.json });
    });

  standby
    .command("resume")
    .description("Reanuda una sesión hibernada (re-spawn comando original)")
    .argument("<sessionId>")
    .option("--force", "Reanudar aunque cooldownUntil todavía esté en el futuro (no recomendado)")
    .action(async (sessionId, flags) => {
      await resumeCommand({ sessionId, force: Boolean(flags.force) });
    });
}
