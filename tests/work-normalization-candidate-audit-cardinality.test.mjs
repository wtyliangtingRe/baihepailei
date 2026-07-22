import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const repoRoot = process.cwd()
const source = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/audit-work-normalization-candidates-v01.ps1'),
  'utf8',
)
const wrapper = fs.readFileSync(
  path.join(repoRoot, 'scripts/radar/run-and-package-work-normalization-audit-v01.ps1'),
  'utf8',
)
const guideIndex = fs.readFileSync(path.join(repoRoot, 'docs/guides/README.md'), 'utf8')

test('normalization audit preserves zero, one, and many query results as arrays', () => {
  for (const variable of ['humanCandidates', 'schemaExceptions', 'rankCandidates', 'counts']) {
    assert.match(
      source,
      new RegExp(`\\$${variable}\\s*=\\s*@\\(\\s*Invoke-ReadOnlyQuery`, 'u'),
      `${variable} must be collected with an array subexpression`,
    )
  }

  assert.match(source, /SchemaExceptionRows: \$\(\$schemaExceptions\.Count\)/u)
  assert.match(source, /\[AllowEmptyCollection\(\)\]\[AllowEmptyString\(\)\]\[string\[\]\]\$Lines/u)
})

test('one-command wrapper validates artifacts before creating a literal-path archive', () => {
  assert.match(wrapper, /audit-work-normalization-candidates-v01\.ps1/u)
  assert.match(wrapper, /\$missingFiles\.Count -gt 0/u)
  assert.match(wrapper, /Compress-Archive/u)
  assert.match(wrapper, /-LiteralPath \$paths/u)
  assert.doesNotMatch(wrapper, /-LiteralPath[^\n]*\*/u)
  assert.match(wrapper, /DatabaseWrite\s+: False/u)
  assert.match(wrapper, /MigrationRun\s+: False/u)
})

test('guide index links the assessment, normalization, and publication safety guides', () => {
  assert.match(guideIndex, /work-assessment-model-v01\.md/u)
  assert.match(guideIndex, /work-schema-normalization-runbook-v01\.md/u)
  assert.match(guideIndex, /radar-publication-safety-v01\.md/u)
})
