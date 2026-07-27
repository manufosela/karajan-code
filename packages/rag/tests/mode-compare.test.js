// @ts-check
/**
 * KJR-TSK-0144 — comparativa offline CAG vs RAG sobre el golden set:
 * recall del retrieval vs coste de contexto, con recomendación heurística
 * honesta (sin LLM). El objetivo es decidir modo con datos, no a ojo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareModes } from '../src/evaluation/mode-compare.js';

/** @returns {Promise<string>} */
async function makeCorpus() {
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-modecmp-'));
  await writeFile(path.join(root, 'facturacion.md'), '# Facturación\nLa factura se calcula con la tarifa base más impuestos.\n', 'utf8');
  await writeFile(path.join(root, 'despliegue.md'), '# Despliegue\nEl servicio se despliega con terraform apply en cloud run.\n', 'utf8');
  await writeFile(path.join(root, 'soporte.md'), '# Soporte\nLos tickets se gestionan en el panel interno.\n', 'utf8');
  return root;
}

const GOLDEN = {
  topK: 1,
  baseline: { answerRelevance: 0 },
  cases: [
    {
      id: 'facturas',
      question: 'cómo se calcula la factura con tarifa base',
      expectedAnswer: 'Con la tarifa base más impuestos.',
      relevantSources: ['facturacion.md'],
    },
    {
      id: 'imposible',
      question: 'qué dice el manual de vacaciones',
      expectedAnswer: 'No existe en el corpus.',
      relevantSources: ['vacaciones.md'],
    },
  ],
};

test('compareModes: recall por caso, tamaños de contexto y ratio de coste', async () => {
  const root = await makeCorpus();
  try {
    const report = await compareModes(/** @type {never} */ (GOLDEN), { corpusDir: root });

    assert.equal(report.cagFits, true);
    assert.ok(report.cagChars > 0);
    assert.equal(report.perCase.length, 2);

    const facturas = report.perCase.find((c) => c.id === 'facturas');
    const imposible = report.perCase.find((c) => c.id === 'imposible');
    assert.ok(facturas && imposible);
    assert.equal(facturas.ragRecall, 1, 'la fuente relevante aparece en el top-k');
    assert.equal(imposible.ragRecall, 0, 'fuente inexistente → recall 0');
    assert.ok(facturas.ragChars > 0 && facturas.ragChars < report.cagChars, 'RAG usa menos contexto que CAG');
    assert.ok(facturas.costRatio > 1, 'CAG cuesta más contexto por consulta');

    assert.ok(report.aggregates.ragRecall > 0 && report.aggregates.ragRecall < 1);
    assert.ok(typeof report.recommendation === 'string' && report.recommendation.length > 10);
    // Recall imperfecto + corpus que cabe → la heurística sugiere cag.
    assert.equal(report.recommendedMode, 'cag');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compareModes: recall perfecto → recomienda rag (contexto N veces menor)', async () => {
  const root = await makeCorpus();
  try {
    const golden = {
      ...GOLDEN,
      cases: [GOLDEN.cases[0]],
    };
    const report = await compareModes(/** @type {never} */ (golden), { corpusDir: root });
    assert.equal(report.aggregates.ragRecall, 1);
    assert.equal(report.recommendedMode, 'rag');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compareModes: corpus que excede el presupuesto CAG → cagFits false y recomienda rag', async () => {
  const root = await makeCorpus();
  try {
    const report = await compareModes(/** @type {never} */ (GOLDEN), {
      corpusDir: root,
      cagMaxChars: 50,
    });
    assert.equal(report.cagFits, false);
    assert.ok(report.cagChars > 50, 'reporta el tamaño real aunque no quepa');
    assert.equal(report.recommendedMode, 'rag');
    assert.ok(report.recommendation.includes('50'), 'la recomendación menciona el presupuesto');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runEvalCommand --compare-modes: imprime la comparativa y la devuelve en el report', async () => {
  const { runEvalCommand } = await import('../src/easy/cli.js');
  const { mkdir } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'kjr-modecmp-cli-'));
  try {
    await mkdir(path.join(root, 'corpus'), { recursive: true });
    await writeFile(path.join(root, 'corpus', 'doc.md'), '# Doc\nLa tarifa base incluye impuestos.\n', 'utf8');
    await writeFile(
      path.join(root, 'golden.json'),
      JSON.stringify({
        topK: 1,
        baseline: { answerRelevance: 0 },
        cases: [{ id: 'c1', question: 'qué incluye la tarifa base', expectedAnswer: 'Impuestos.', relevantSources: ['doc.md'] }],
      }),
      'utf8',
    );
    /** @type {string[]} */
    const lines = [];
    const report = await runEvalCommand(
      [path.join(root, 'golden.json'), '--compare-modes'],
      { out: (msg) => lines.push(msg) },
    );
    assert.ok('modeComparison' in report && report.modeComparison);
    assert.ok(lines.some((l) => l.includes('cag vs rag')));
    assert.ok(lines.some((l) => l.includes('recomendación')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
