// @ts-check

/**
 * @typedef {import('./pipeline-config.js').PipelineConfig} PipelineConfig
 * @typedef {import('../pipeline/role-registry.js').RoleRegistry} RoleRegistry
 * @typedef {import('../pipeline/types.js').Stage<any, any>} Stage
 */

/**
 * Construye un array de Stages a partir de una PipelineConfig, usando un
 * RoleRegistry para resolver cada rol por nombre. Cada stage envuelve
 * la llamada `role.run(input, ctx)` de modo que el Pipeline Engine pueda
 * ejecutarlo sin conocer el concepto de Role.
 *
 * @param {PipelineConfig} config
 * @param {RoleRegistry} registry
 * @returns {Stage[]}
 */
export function buildPipelineFromConfig(config, registry) {
  if (!config || !Array.isArray(config.stages)) {
    throw new Error('buildPipelineFromConfig: config con stages requerido.');
  }
  if (!registry || typeof registry.resolve !== 'function') {
    throw new Error('buildPipelineFromConfig: RoleRegistry requerido.');
  }

  return config.stages.map((stageCfg) => {
    if (!registry.has(stageCfg.role)) {
      const available = registry.list().join(', ') || '<ninguno>';
      throw new Error(
        `buildPipelineFromConfig: rol "${stageCfg.role}" no registrado. Disponibles: ${available}.`,
      );
    }
    const role = registry.resolve(stageCfg.role);
    return {
      name: stageCfg.name ?? stageCfg.role,
      run: async (input, ctx) => {
        // Se combina el input del stage anterior con las options declaradas,
        // de modo que los roles reciban siempre el mismo shape.
        const merged =
          input && typeof input === 'object' && !Array.isArray(input)
            ? { ...stageCfg.options, ...input }
            : { ...stageCfg.options, input };
        return role.run(merged, ctx.tools);
      },
    };
  });
}
