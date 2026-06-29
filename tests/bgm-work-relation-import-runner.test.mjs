import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRunnerSteps,
  parseRunnerArgs,
  runBgmWorkRelationImport,
} from '../tools/source_import/scripts/run-bgm-work-relation-import.mjs';

test('relation runner defaults to dry-run mode', () => {
  assert.deepEqual(parseRunnerArgs([]), { apply: false, help: false });
  assert.deepEqual(parseRunnerArgs(['--apply']), { apply: true, help: false });
  assert.deepEqual(parseRunnerArgs(['-h']), { apply: false, help: true });
});

test('dry-run relation runner stops before real apply and readback audit', () => {
  const steps = buildRunnerSteps({ apply: false, nodeBin: 'node' });
  assert.equal(steps.length, 3);
  assert.equal(steps.at(-1).name, 'Dry-run BGM work relation apply');
  assert.equal(steps.some((step) => step.args.includes('--apply')), false);
  assert.equal(steps.some((step) => step.args[0].includes('audit-bgm-work-entity-link-readback')), false);
});

test('apply relation runner includes dry-run, real apply, and readback audit', () => {
  const steps = buildRunnerSteps({ apply: true, nodeBin: 'node' });
  assert.equal(steps.length, 5);
  assert.equal(steps[2].name, 'Dry-run BGM work relation apply');
  assert.equal(steps[3].name, 'Apply BGM work relations');
  assert.deepEqual(steps[3].args, ['tools/source_import/scripts/apply-bgm-work-entity-link-plan.mjs', '--apply']);
  assert.equal(steps[4].name, 'Audit BGM work relation readback');
});

test('relation runner executes steps in order with an injectable command runner', async () => {
  const executed = [];
  const result = await runBgmWorkRelationImport({ apply: false, nodeBin: 'node' }, async (step) => {
    executed.push(step.name);
  });

  assert.equal(result.status, 'pass');
  assert.deepEqual(executed, buildRunnerSteps({ apply: false, nodeBin: 'node' }).map((step) => step.name));
});
