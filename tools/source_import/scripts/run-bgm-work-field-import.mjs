#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RUNNER_SCHEMA_VERSION = 1;

export function parseRunnerArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return {
    apply: args.has('--apply'),
    help: args.has('--help') || args.has('-h'),
  };
}

export function buildRunnerSteps(options = {}) {
  const nodeBin = options.nodeBin ?? process.execPath;
  const steps = [
    {
      name: 'Build BGM work entity link plan',
      command: nodeBin,
      args: ['tools/source_import/scripts/build-bgm-work-entity-link-plan.mjs'],
    },
    {
      name: 'Audit BGM work entity link plan',
      command: nodeBin,
      args: ['tools/source_import/scripts/audit-bgm-work-entity-link-plan.mjs'],
    },
    {
      name: 'Build BGM work field plan',
      command: nodeBin,
      args: ['tools/source_import/scripts/build-bgm-work-field-plan.mjs'],
    },
    {
      name: 'Clean BGM work field plan text',
      command: nodeBin,
      args: ['tools/source_import/scripts/clean-bgm-work-field-plan-text.mjs'],
    },
    {
      name: 'Dry-run BGM work field apply',
      command: nodeBin,
      args: ['tools/source_import/scripts/apply-bgm-work-field-plan.mjs'],
    },
  ];

  if (options.apply) {
    steps.push(
      {
        name: 'Apply BGM work fields',
        command: nodeBin,
        args: ['tools/source_import/scripts/apply-bgm-work-field-plan.mjs', '--apply'],
      },
      {
        name: 'Audit BGM work field readback',
        command: nodeBin,
        args: ['tools/source_import/scripts/audit-bgm-work-field-readback.mjs'],
      },
    );
  }

  return steps;
}

function usage() {
  return [
    'Usage:',
    '  node tools/source_import/scripts/run-bgm-work-field-import.mjs',
    '  node tools/source_import/scripts/run-bgm-work-field-import.mjs --apply',
    '',
    'Default mode is dry-run only. Use --apply to write fields and run readback audit.',
  ].join('\n');
}

function validateOptions(options) {
  if (options.apply && !process.env.PAYLOAD_TOKEN) {
    throw new Error('PAYLOAD_TOKEN is required when running with --apply.');
  }
}

export async function runStep(step, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const stdio = options.stdio ?? 'inherit';
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, { cwd, env, stdio, shell: false });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ code });
      else reject(new Error(`${step.name} failed with exit code ${code}`));
    });
  });
}

export async function runBgmWorkFieldImport(options = {}, runner = runStep) {
  validateOptions(options);
  const steps = buildRunnerSteps(options);
  const results = [];
  console.log(`BGM work field import runner: ${options.apply ? 'apply' : 'dry-run'}`);
  for (const [index, step] of steps.entries()) {
    console.log(`\n[${index + 1}/${steps.length}] ${step.name}`);
    await runner(step);
    results.push({ name: step.name, status: 'ok' });
  }
  console.log('\nBGM work field import runner status: pass');
  return { status: 'pass', steps: results };
}

async function main() {
  const options = parseRunnerArgs();
  if (options.help) {
    console.log(usage());
    return;
  }
  await runBgmWorkFieldImport(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
