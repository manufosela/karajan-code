// @ts-check
/**
 * F2 — juicio LLM gobernado por la sensitivity policy.
 *
 * Recibe las señales crudas (candidatos del retrieval + co-cambios git)
 * y pide a un adapter LLM un veredicto estructurado: qué ficheros de
 * otros repos se ven afectados, por qué y con qué severidad.
 *
 * Reglas duras:
 * - Solo adapters que la policy de karajan-rag permite para el nivel
 *   efectivo del corpus. Un adapter explícito no permitido es un error —
 *   NUNCA se degrada a otro en silencio (a diferencia de
 *   `resolveAdapterFor` upstream, que hace fallback del preferred).
 * - Salida no parseable o con esquema roto = {@link JudgmentError}.
 * - Un `source` que no esté entre los candidatos es una alucinación: error.
 * - Todo texto que sale (summary, reasons) pasa por redactPII.
 */
import { isProviderAllowed, redactPII, SENSITIVITY_LEVELS } from 'karajan-rag';

/** Error del juicio LLM: el pipeline falla ruidosamente. */
export class JudgmentError extends Error {
  /**
   * @param {string} message
   * @param {{cause?: unknown}} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'JudgmentError';
  }
}

/**
 * Cuánto se espera al adapter antes de dar el juicio por perdido.
 *
 * Sin tope, un adapter lento o colgado deja el workflow ocupado hasta el
 * límite del runner sin informe ni explicación (KJW-BUG-0006).
 */
export const JUDGMENT_TIMEOUT_MS = 120_000;

/** Severidades admitidas en el veredicto. */
export const SEVERITIES = Object.freeze(['low', 'medium', 'high']);

/**
 * Topes de lo que entra al prompt.
 *
 * Sin ellos, un repo con cientos de commits aporta cientos de líneas de
 * co-cambios y el prompt se dispara: en el primer smoke real midió 88.727
 * caracteres y dejó el pipeline masticando durante minutos (KJW-BUG-0004).
 * Lo que se recorta se declara en el propio prompt, nunca en silencio.
 */
export const PROMPT_LIMITS = Object.freeze({
  candidates: 10,
  evidencePerCandidate: 3,
  coChangesPerRepo: 8,
  contracts: 15,
});

/**
 * @typedef {import('./retrieval.js').ImpactCandidate} ImpactCandidate
 * @typedef {import('./cochanges.js').CoChangeResult} CoChangeResult
 *
 * @typedef {Object} AffectedEntry
 * @property {string} source Fichero afectado (`repo/path`) con scope `file`;
 *   nombre del repo con scope `repo`.
 * @property {'file' | 'repo'} scope Alcance del aviso (KJW-BUG-0009): `file`
 *   señala un fichero de las señales; `repo` un repositorio en conjunto —
 *   colgar un aviso de repo de un fichero es precisión fingida.
 * @property {'low' | 'medium' | 'high'} severity
 * @property {string} reason
 *
 * @typedef {Object} Verdict
 * @property {string} summary
 * @property {AffectedEntry[]} affected
 *
 * @typedef {Object} JudgmentResult
 * @property {string} adapter Adapter usado.
 * @property {Verdict} verdict Veredicto validado y con PII redactada.
 * @property {number} discardedEntries Entradas del veredicto descartadas por
 *   citar fuentes fuera de las señales (0 = veredicto íntegro).
 * @property {Array<{source: string, kind: 'format' | 'unknown'}>} [discarded]
 *   Detalle del descarte (KJW-TSK-0040): `format` = la fuente se corresponde
 *   con una señal conocida escrita de otra forma (el adapter se saltó el
 *   formato, no inventó); `unknown` = no aparece en ninguna señal.
 * @property {boolean} [insufficientSignal] true cuando las tres señales
 *   llegaron vacías y NO se pidió veredicto al adapter (KJW-BUG-0010).
 */

/**
 * Construye el prompt del juicio. El adapter debe responder SOLO con el
 * JSON del veredicto.
 *
 * @param {Object} params
 * @param {ImpactCandidate[]} params.candidates
 * @param {CoChangeResult} params.coChanges
 * @param {string} params.diffSummary
 * @param {import('./contracts.js').ContractMatch[]} [params.contracts]
 * @returns {string}
 */
export const buildJudgmentPrompt = ({ candidates, coChanges, diffSummary, contracts = [] }) => {
  const omitted = (total, shown) =>
    total > shown ? ` (+${total - shown} more)` : '';

  const candidateLines = candidates.slice(0, PROMPT_LIMITS.candidates).map((c) => {
    const shown = c.evidence.slice(0, PROMPT_LIMITS.evidencePerCandidate);
    const evidence = shown
      .map((e) => `${e.fromChunk.path}@${e.fromChunk.newStart}→línea ${e.line ?? '?'}`)
      .join(', ');
    return `- ${c.source} (score ${c.score.toFixed(2)}): evidencia ${evidence}${omitted(c.evidence.length, shown.length)}`;
  });

  // Los co-cambios se ordenan por frecuencia y se cortan: son la señal que
  // más volumen genera y la que menos aporta en su cola larga.
  const coChangeLines = [
    ...coChanges.byRepo.flatMap((r) => {
      const ranked = r.coChanges.toSorted((a, b) => b.count - a.count);
      const shown = ranked.slice(0, PROMPT_LIMITS.coChangesPerRepo);
      const lines = shown.map(
        (c) => `- ${r.repo}: ${c.path} (count ${c.count}, último ${c.lastDate})`,
      );
      if (ranked.length > shown.length) {
        lines.push(`- ${r.repo}: +${ranked.length - shown.length} more co-changes not listed`);
      }
      return lines;
    }),
    ...coChanges.noSignal.map((r) => `- ${r.repo}: sin señal (${r.reason})`),
  ];
  return [
    'Eres el juez de impacto cross-repo de karajan-watch. Se ha mergeado un cambio',
    'y debes valorar qué ficheros de OTROS repos pueden verse afectados.',
    '',
    `## Cambio mergeado`,
    diffSummary,
    '',
    '## Candidatos por similitud (retrieval)',
    ...candidateLines,
    '',
    '## Co-cambios históricos (git)',
    ...coChangeLines,
    '',
    ...(contracts.length > 0
      ? [
          '## Contracts shared with the diff (hard evidence, not similarity)',
          ...contracts.slice(0, PROMPT_LIMITS.contracts).map(
            (c) =>
              `- ${c.source}: ${c.tokens
                .map((t) => `${t.value} (${t.type}${t.removed ? ', REMOVED in this merge' : ''})`)
                .join(', ')}`,
          ),
          '',
        ]
      : []),
    'Responde SOLO con un JSON válido con esta forma exacta:',
    '{"summary": "<síntesis en una o dos frases>", "affected": [{"source": "<uno de los candidatos>", "scope": "file", "severity": "low|medium|high", "reason": "<por qué>"}]}',
    'Incluye en "affected" únicamente candidatos con impacto plausible; puede ser una lista vacía.',
    'Si tu conclusión aplica a un REPOSITORIO en su conjunto (p.ej. «los clientes que',
    'parsean esta respuesta deberán actualizarse») y no a un fichero concreto de las',
    'señales, usa {"scope": "repo", "source": "<nombre del repo>"} — nunca cuelgues',
    'un aviso de repo de un fichero que no lo justifica.',
  ].join('\n');
};

/**
 * Parsea y valida el veredicto del adapter. Tolerante con el formato
 * (fences, texto alrededor), estricto con el esquema.
 *
 * @param {string} rawText
 * @returns {Verdict}
 */
export const parseVerdict = (rawText) => {
  if (typeof rawText !== 'string') {
    throw new JudgmentError('el adapter devolvió un valor que no es texto.');
  }
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new JudgmentError('el adapter no devolvió ningún objeto JSON.');
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText.slice(start, end + 1));
  } catch (err) {
    throw new JudgmentError('el veredicto no es JSON parseable.', { cause: err });
  }
  if (typeof parsed.summary !== 'string' || parsed.summary.length === 0) {
    throw new JudgmentError('veredicto inválido: "summary" debe ser un string no vacío.');
  }
  if (!Array.isArray(parsed.affected)) {
    throw new JudgmentError('veredicto inválido: "affected" debe ser un array.');
  }
  const affected = parsed.affected.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new JudgmentError(`veredicto inválido: affected[${i}] no es un objeto.`);
    }
    if (typeof entry.source !== 'string' || entry.source.length === 0) {
      throw new JudgmentError(`veredicto inválido: affected[${i}].source requerido.`);
    }
    if (!SEVERITIES.includes(entry.severity)) {
      throw new JudgmentError(
        `veredicto inválido: affected[${i}].severity debe ser ${SEVERITIES.join(' | ')}.`,
      );
    }
    if (typeof entry.reason !== 'string' || entry.reason.length === 0) {
      throw new JudgmentError(`veredicto inválido: affected[${i}].reason requerido.`);
    }
    // Alcance opcional (KJW-BUG-0009): ausente = file, el contrato de siempre.
    const scope = entry.scope ?? 'file';
    if (scope !== 'file' && scope !== 'repo') {
      throw new JudgmentError(`veredicto inválido: affected[${i}].scope debe ser file | repo.`);
    }
    return { source: entry.source, scope, severity: entry.severity, reason: entry.reason };
  });
  return { summary: parsed.summary, affected };
};

/**
 * Pide el juicio de impacto a un adapter permitido por la policy.
 *
 * @param {Object} params
 * @param {ImpactCandidate[]} params.candidates
 * @param {CoChangeResult} params.coChanges
 * @param {string} params.diffSummary
 * @param {import('karajan-rag').Sensitivity} params.sensitivity Nivel efectivo del corpus.
 * @param {Record<string, string[]>} params.policy Sensitivity policy (niveles → adapters).
 * @param {import('./contracts.js').ContractMatch[]} [params.contracts] Contratos compartidos (señal 4), como contexto del juicio.
 * @param {string} [params.adapter] Adapter explícito; debe estar permitido.
 * @param {(adapterName: string, prompt: string) => Promise<string>} params.runAdapter Ejecuta el adapter (el wiring real llega en KJW-TSK-0008).
 * @param {(text: string) => {text: string}} [params.redact] Default: redactPII de karajan-rag.
 * @param {number} [params.timeoutMs] Tope de espera al adapter (default {@link JUDGMENT_TIMEOUT_MS}).
 * @returns {Promise<JudgmentResult>}
 */
export const judgeImpact = async ({
  candidates,
  coChanges,
  diffSummary,
  sensitivity,
  policy,
  contracts = [],
  adapter,
  runAdapter,
  redact = redactPII,
  timeoutMs = JUDGMENT_TIMEOUT_MS,
}) => {
  if (!SENSITIVITY_LEVELS.includes(sensitivity)) {
    throw new JudgmentError(
      `sensibilidad "${sensitivity}" desconocida (esperado: ${SENSITIVITY_LEVELS.join(' | ')}).`,
    );
  }
  const allowed = policy[sensitivity];
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new JudgmentError(`la policy no permite ningún adapter para el nivel "${sensitivity}".`);
  }
  if (adapter && !isProviderAllowed(/** @type {never} */ (policy), sensitivity, adapter)) {
    throw new JudgmentError(
      `el adapter "${adapter}" no está permitido por la policy para el nivel "${sensitivity}" ` +
        `(permitidos: ${allowed.join(', ')}). No se degrada a otro adapter.`,
    );
  }
  const adapterName = adapter ?? allowed[0];

  // El prompt muestra TRES señales, así que el veredicto puede apoyarse en
  // cualquiera de ellas: validar solo contra el retrieval convertía en
  // "alucinación" un juicio legítimo basado en co-cambios (KJW-BUG-0005).
  const knownSources = new Set([
    ...candidates.map((c) => c.source),
    ...contracts.map((c) => c.source),
    ...coChanges.byRepo.flatMap((r) => r.coChanges.map((c) => `${r.repo}/${c.path}`)),
  ]);

  // Tres señales vacías = nada contra lo que validar: pedir veredicto
  // garantizaba el aborto (en campo, 8/8 merges sin retrieval — y eran los
  // diffs quirúrgicos, KJW-BUG-0010). No se llama al adapter y el informe
  // lo dice, en vez de castigar una recuperación vacía como alucinación.
  if (knownSources.size === 0) {
    return {
      adapter: adapterName,
      verdict: {
        summary:
          'sin señal suficiente para juzgar: retrieval, co-cambios y contratos ' +
          'llegaron vacíos — no se pidió veredicto al adapter.',
        affected: [],
      },
      discardedEntries: 0,
      insufficientSignal: true,
    };
  }

  const prompt = buildJudgmentPrompt({ candidates, coChanges, diffSummary, contracts });
  let raw;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    raw = await Promise.race([
      runAdapter(adapterName, prompt),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new JudgmentError(
                `el adapter "${adapterName}" no respondió en ${timeoutMs} ms: juicio abortado.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } catch (err) {
    if (err instanceof JudgmentError) throw err;
    throw new JudgmentError(`el adapter "${adapterName}" falló durante el juicio.`, {
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }

  const verdict = parseVerdict(raw);
  // Una entrada que cita una fuente fuera de las señales se DESCARTA con
  // contador; las fundadas sobreviven. Abortar el juicio entero por una
  // entrada convertía un veredicto casi íntegro en ningún informe
  // (KJW-BUG-0010 — antes tiraba el merge completo).
  // Una entrada de alcance repo se valida contra los REPOS de las señales
  // (KJW-BUG-0009) — incluidos los que aparecen sin señal de co-cambios,
  // que también estuvieron delante del juez.
  const knownRepos = new Set([
    ...candidates.map((c) => c.repo),
    ...contracts.map((c) => c.repo),
    ...coChanges.byRepo.map((r) => r.repo),
    ...coChanges.noSignal.map((r) => r.repo),
  ]);
  // «Formato saltado» ≠ «inventado» (KJW-TSK-0040): si la fuente devuelta se
  // corresponde con una señal conocida escrita de otra forma («repo: ruta»,
  // solo el prefijo), el adapter no alucinó — incumplió el formato. Ambos se
  // descartan, pero decirlos distinto evita despistar sobre la causa.
  const looksLikeKnown = (value) => {
    const normalized = value.replace(/:\s*/g, '/');
    for (const known of knownSources) {
      if (known === normalized || known.startsWith(value) || value.startsWith(known)) return true;
    }
    return knownRepos.has(value.split(/[/:]/)[0]);
  };
  const backed = [];
  /** @type {Array<{source: string, kind: 'format' | 'unknown'}>} */
  const discarded = [];
  for (const entry of verdict.affected) {
    const known = entry.scope === 'repo' ? knownRepos : knownSources;
    if (known.has(entry.source)) backed.push(entry);
    else discarded.push({ source: entry.source, kind: looksLikeKnown(entry.source) ? 'format' : 'unknown' });
  }

  return {
    adapter: adapterName,
    verdict: {
      summary: redact(verdict.summary).text,
      affected: backed.map((entry) => ({
        ...entry,
        reason: redact(entry.reason).text,
      })),
    },
    discardedEntries: discarded.length,
    discarded,
  };
};
