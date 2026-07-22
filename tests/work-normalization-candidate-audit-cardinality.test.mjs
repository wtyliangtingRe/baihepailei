import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = fs.readFileSync(
  path.join(process.cwd(), 'scripts/radar/audit-work-normalization-candidates-v01.ps1'),
  'utf8',
)

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
