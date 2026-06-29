import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRunnerSteps,
  parseRunnerArgs,
  runBgmWorkFieldImport,
} from '../tools/source_import/scripts/run-bgm-work-field-import.mjs';

test('runner defaults to dry-run mode', () => {
  assert.deepEqual(parseRunnerArgs([]), { apply: false, help: false });
  assert.deepEqual(parseRunnerArgs(['--apply']), { apply: true, help: false });
  assert.deepEqual(parseRunnerArgs(['--help']), { apply: false, help: true });
});

test('dry-run runner stops before real apply and readback audit', () => {
  const steps = buildRunnerSteps({ apply: false, nodeBin: 'node' });
  assert.equal(steps.length, 5);
  assert.equal(steps.at(-1).name, 'Dry-run BGM work field apply');
  assert.equal(steps.some((step) => step.args.includes('--apply')), false);
  assert.equal(steps.some((step) => step.args[0].includes('audit-bgm-work-field-readback')), false);
});

test('apply runner includes dry-run, real apply, and readback audit', () => {
  const steps = buildRunnerSteps({ apply: true, nodeBin: 'node' });
  assert.equal(steps.length, 7);
  assert.equal(steps[4].name, 'Dry-run BGM work field apply');
  assert.equal(steps[5].name, 'Apply BGM work fields');
  assert.deepEqual(steps[5].args, ['tools/source_import/scripts/apply-bgm-work-field-plan.mjs', '--apply']);
  assert.equal(steps[6].name, 'Audit BGM work field readback');
});

test('runner executes steps in order with an injectable command runner', async () => {
  const executed = [];
  const result = await runBgmWorkFieldImport({ apply: false, nodeBin: 'node' }, async (step) => {
    executed.push(step.name);
  });

  assert.equal(result.status, 'pass');
  assert.deepEqual(executed, buildRunnerSteps({ apply: false, nodeBin: 'node' }).map((step) => step.name));
});
