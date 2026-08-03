import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migrationDirectory = new URL(
  '../src/migrations/',
  import.meta.url,
)

const expectedColumns = [
  'confidence_percent',
  'evidence_coverage_percent',
  'metrics_policy_version',
  'source_metrics_policy_version',
  'relationship_evidence_state',
  'metrics_source_release_id',
  'metrics_calculation_basis_sha256',
  'requires_metric_review',
]

function migrationPair() {
  const names = fs.readdirSync(migrationDirectory)

  const typeScript = names.filter(
    (name) =>
      name.includes('radar_public_metrics_v01')
      && name.endsWith('.ts'),
  )

  const snapshots = names.filter(
    (name) =>
      name.includes('radar_public_metrics_v01')
      && name.endsWith('.json'),
  )

  assert.equal(typeScript.length, 1)
  assert.equal(snapshots.length, 1)

  assert.equal(
    typeScript[0].replace(/\.ts$/u, ''),
    snapshots[0].replace(/\.json$/u, ''),
  )

  return {
    typeScript: typeScript[0],
    snapshot: snapshots[0],
  }
}

test('metrics migration is registered exactly once', () => {
  const pair = migrationPair()

  const stem = pair.typeScript.replace(/\.ts$/u, '')

  const indexSource = fs.readFileSync(
    new URL('index.ts', migrationDirectory),
    'utf8',
  )

  const escapedStem = stem.replace(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&',
  )

  const importMatches = indexSource.match(
    new RegExp(
      `from ['"]\\./${escapedStem}['"]`,
      'gu',
    ),
  ) || []

  const nameMatches = indexSource.match(
    new RegExp(
      `name:\\s*['"]${escapedStem}['"]`,
      'gu',
    ),
  ) || []

  const aliasMatch = indexSource.match(
    new RegExp(
      `import \\* as ([A-Za-z0-9_$]+) from ['"]\\./${escapedStem}['"]`,
      'u',
    ),
  )

  assert.equal(importMatches.length, 1)
  assert.equal(nameMatches.length, 1)
  assert.ok(aliasMatch)

  const alias = aliasMatch[1]
  const escapedAlias = alias.replace(
    /[.*+?^${}()|[\]\\]/gu,
    '\\$&',
  )

  const upMatches = indexSource.match(
    new RegExp(
      `up:\\s*${escapedAlias}\\.up`,
      'gu',
    ),
  ) || []

  const downMatches = indexSource.match(
    new RegExp(
      `down:\\s*${escapedAlias}\\.down`,
      'gu',
    ),
  ) || []

  assert.equal(upMatches.length, 1)
  assert.equal(downMatches.length, 1)
})

test('metrics migration only adds fields to radar_public_ratings', () => {
  const pair = migrationPair()

  const source = fs.readFileSync(
    new URL(pair.typeScript, migrationDirectory),
    'utf8',
  )

  const marker = source.indexOf(
    'export async function down',
  )

  assert.notEqual(marker, -1)

  const up = source.slice(0, marker)
  const down = source.slice(marker)

  for (const column of expectedColumns) {
    assert.match(
      up,
      new RegExp(column),
    )
  }

  assert.doesNotMatch(
    up,
    /\b(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE)\b/iu,
  )

  assert.doesNotMatch(
    down,
    /\b(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|TRUNCATE)\b/iu,
  )

  assert.doesNotMatch(
    up,
    /\b(?:CREATE|DROP)\s+TABLE\b/iu,
  )

  assert.doesNotMatch(
    up,
    /\bDROP\s+(?:COLUMN|INDEX|TYPE)\b/iu,
  )

  const alteredTables = [
    ...source.matchAll(
      /ALTER\s+TABLE(?:\s+IF\s+EXISTS)?\s+(?:(?:"public"\.)?)"([^"]+)"/giu,
    ),
  ].map((match) => match[1])

  assert.ok(alteredTables.length > 0)

  assert.deepEqual(
    [...new Set(alteredTables)],
    ['radar_public_ratings'],
  )

  const createdTypes = [
    ...source.matchAll(
      /CREATE\s+TYPE\s+(?:(?:"public"\.)?)"([^"]+)"/giu,
    ),
  ].map((match) => match[1])

  assert.ok(
    createdTypes.every((name) =>
      name.startsWith('enum_radar_public_ratings'),
    ),
  )
})

test('metrics snapshot preserves existing tables and all metric fields', () => {
  const pair = migrationPair()

  const source = fs.readFileSync(
    new URL(pair.snapshot, migrationDirectory),
    'utf8',
  )

  assert.doesNotThrow(() => JSON.parse(source))

  assert.match(source, /"public\.works"/u)
  assert.match(
    source,
    /"public\.radar_public_records"/u,
  )
  assert.match(
    source,
    /"public\.radar_public_ratings"/u,
  )

  for (const column of expectedColumns) {
    assert.match(
      source,
      new RegExp(`"${column}"`),
    )
  }
})
