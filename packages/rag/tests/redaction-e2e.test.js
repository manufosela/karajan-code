// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RedactionRole } from '../src/redaction/redaction-role.js';
import { GeneratorRole } from '../src/generation/generator-role.js';
import { createDefaultSensitivityPolicy } from '../src/policy/sensitivity-policy.js';

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeHit(id, content, sensitivity) {
  return {
    id,
    score: 1,
    vector: [],
    metadata: { content, sensitivity },
  };
}

test('RedactionRole: aplica redactPII a chunks permitidos', async () => {
  const policy = createDefaultSensitivityPolicy();
  const role = new RedactionRole({
    name: 'red',
    logger: silentLogger(),
    policy,
    targetProvider: 'claude',
  });
  const result = await role.run(
    {
      query: 'q',
      contextChunks: [
        makeHit('c1', 'Email: admin@example.com fue contactado', 'public'),
        makeHit('c2', 'NIF 12345678Z titular', 'public'),
      ],
    },
    { get: () => null, has: () => false },
  );
  assert.equal(result.contextChunks.length, 2);
  assert.ok(result.contextChunks[0].metadata.content.includes('[REDACTED_EMAIL]'));
  assert.ok(result.contextChunks[1].metadata.content.includes('[REDACTED_ID]'));
  assert.equal(result.report.redacted, 2);
  assert.ok(result.report.counts.email >= 1);
});

test('RedactionRole: bloquea chunk confidential enviado a claude (público)', async () => {
  const policy = createDefaultSensitivityPolicy();
  const role = new RedactionRole({
    name: 'red',
    logger: silentLogger(),
    policy,
    targetProvider: 'claude',
  });
  await assert.rejects(
    () =>
      role.run(
        {
          query: 'q',
          contextChunks: [makeHit('c1', 'datos secretos', 'confidential')],
        },
        { get: () => null, has: () => false },
      ),
    /bloqueado por policy/,
  );
});

test('RedactionRole: permite chunk confidential a ollama', async () => {
  const policy = createDefaultSensitivityPolicy();
  const role = new RedactionRole({
    name: 'red',
    logger: silentLogger(),
    policy,
    targetProvider: 'ollama',
  });
  const result = await role.run(
    {
      query: 'q',
      contextChunks: [makeHit('c1', 'datos secretos', 'confidential')],
    },
    { get: () => null, has: () => false },
  );
  assert.equal(result.contextChunks.length, 1);
});

test('E2E: policy block detiene al pipeline antes de llamar al adapter', async () => {
  const policy = createDefaultSensitivityPolicy();
  const redaction = new RedactionRole({
    name: 'red',
    logger: silentLogger(),
    policy,
    targetProvider: 'claude',
  });

  let adapterCalled = false;
  const spyAdapter = async () => {
    adapterCalled = true;
    return {
      provider: 'claude',
      process: { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false },
      parsedOutput: { format: 'json', json: { answer: 'ok' }, text: '' },
    };
  };
  const generator = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: spyAdapter,
  });

  const hits = [makeHit('c1', 'secreto financiero', 'confidential')];
  await assert.rejects(
    async () => {
      const sanitized = await redaction.run(
        { query: 'q', contextChunks: hits },
        { get: () => null, has: () => false },
      );
      await generator.run(sanitized, { get: () => null, has: () => false });
    },
    /bloqueado por policy/,
  );
  assert.equal(adapterCalled, false, 'adapter nunca debe invocarse cuando la policy bloquea');
});

test('E2E: PII redactada antes de llegar al GeneratorRole', async () => {
  const policy = createDefaultSensitivityPolicy();
  const redaction = new RedactionRole({
    name: 'red',
    logger: silentLogger(),
    policy,
    targetProvider: 'ollama',
  });

  let promptSentToAdapter = null;
  const spyAdapter = async (prompt) => {
    promptSentToAdapter = prompt;
    return {
      provider: 'ollama',
      process: { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false },
      parsedOutput: { format: 'json', json: { answer: 'ok' }, text: '' },
    };
  };
  const generator = new GeneratorRole({
    name: 'gen',
    logger: silentLogger(),
    adapter: spyAdapter,
    forceCitation: false,
  });

  const hits = [
    makeHit('c1', 'Contactar admin@empresa.com con el NIF 12345678Z', 'internal'),
  ];
  const sanitized = await redaction.run(
    { query: 'q', contextChunks: hits },
    { get: () => null, has: () => false },
  );
  await generator.run(sanitized, { get: () => null, has: () => false });

  assert.ok(promptSentToAdapter);
  assert.ok(!promptSentToAdapter.includes('admin@empresa.com'));
  assert.ok(!promptSentToAdapter.includes('12345678Z'));
  assert.ok(promptSentToAdapter.includes('[REDACTED_EMAIL]'));
  assert.ok(promptSentToAdapter.includes('[REDACTED_ID]'));
});

test('RedactionRole: valida constructor args', () => {
  const policy = createDefaultSensitivityPolicy();
  // @ts-expect-error missing policy
  assert.throws(() => new RedactionRole({ name: 'r', logger: silentLogger(), targetProvider: 'claude' }), /policy/);
  // @ts-expect-error missing targetProvider
  assert.throws(() => new RedactionRole({ name: 'r', logger: silentLogger(), policy }), /targetProvider/);
});
