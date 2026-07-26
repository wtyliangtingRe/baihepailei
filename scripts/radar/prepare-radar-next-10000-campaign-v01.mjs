#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_TARGET_ROWS,
  DEFAULT_WAVE_SIZE,
  assertOutputPath,
  buildCoverageLedger,
  loadAcceptedCampaignSources,
  parseArgs,
  rejectWriteFlags,
  validateCampaignDirectory,
  validateCampaignZip,
  writeCampaignPackage,
  writeShortfallOutputs,
} from './lib/research-campaign-v01.mjs'

const DEFAULT_BINDING = 'scripts/radar/fixtures/radar-next-10000-campaign-accepted-sources-v01.json'
const DEFAULT_OUTPUT = 'data_local/outputs/ai-radar/research-campaign-next-10000-v01'
const DEFAULT_PACKAGE_ID = 'RADAR-NEXT-CANONICAL-RESEARCH-10000-0001'
const DEFAULT_ZIP_STAGING = 'data_local/staging/radar-next-10000-campaign-zip-validation-v01'

function positiveInteger(value, fallback, label) {
  const result = Number(value ?? fallback)
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`)
  return result
}

export function prepareCampaign(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const bindingFile = path.resolve(cwd, options.bindingFile ?? DEFAULT_BINDING)
  const outputDir = assertOutputPath(options.outputDir ?? DEFAULT_OUTPUT, cwd, 'data_local')
  const binding = JSON.parse(fs.readFileSync(bindingFile, 'utf8'))
  const targetRows = positiveInteger(options.targetRows, DEFAULT_TARGET_ROWS, 'targetRows')
  const waveSize = positiveInteger(options.waveSize, DEFAULT_WAVE_SIZE, 'waveSize')
  const chunkSize = positiveInteger(options.chunkSize, DEFAULT_CHUNK_SIZE, 'chunkSize')
  const accepted = loadAcceptedCampaignSources(cwd, binding)
  const coverage = buildCoverageLedger({
    canonicalRows: accepted.canonicalRows,
    coverageSources: accepted.coverageSources,
    targetRows,
  })
  const metadata = {
    packageId: options.packageId ?? DEFAULT_PACKAGE_ID,
    targetRows,
    waveSize,
    chunkSize,
    sourcePackageId: accepted.metadata.sourcePackageId,
    sourceManifestSha256: accepted.metadata.sourceManifestSha256,
    acceptedSourceBinding: accepted.metadata.acceptedSourceBinding,
  }

  if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true })
  if (!coverage.canPrepare) return writeShortfallOutputs(outputDir, coverage, metadata)
  return writeCampaignPackage(outputDir, coverage, metadata)
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  rejectWriteFlags(args)
  if (args['validate-package']) {
    const root = assertOutputPath(args['validate-package'], process.cwd(), 'data_local')
    const result = validateCampaignDirectory(root, {
      expectedTargetRows: positiveInteger(args['target-rows'], DEFAULT_TARGET_ROWS, 'targetRows'),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return result
  }
  if (args['validate-zip']) {
    const zip = path.resolve(args['validate-zip'])
    const result = validateCampaignZip(
      zip,
      args['staging-dir'] ?? DEFAULT_ZIP_STAGING,
      {
        cwd: process.cwd(),
        expectedSha256: args['expected-sha256'],
        expectedTargetRows: positiveInteger(args['target-rows'], DEFAULT_TARGET_ROWS, 'targetRows'),
      },
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return result
  }
  const result = prepareCampaign({
    bindingFile: args.binding,
    outputDir: args['output-dir'],
    packageId: args['package-id'],
    targetRows: args['target-rows'],
    waveSize: args['wave-size'],
    chunkSize: args['chunk-size'],
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.packagePrepared) process.exitCode = 2
  return result
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  }
}
