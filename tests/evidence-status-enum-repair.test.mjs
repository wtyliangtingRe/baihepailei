import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const sql = fs.readFileSync(new URL('../scripts/db/repair-evidence-status-enums.sql', import.meta.url), 'utf8')
const normalized = sql.replace(/\s+/g, ' ')

const enumNames = ['enum_evidence_status', 'enum__evidence_v_version_status']
const statusValues = ['review', 'confirmed', 'archived']

test('evidence status enum repair covers document and draft version enums', () => {
  for (const enumName of enumNames) {
    for (const value of statusValues) {
      assert.match(
        normalized,
        new RegExp(`ALTER TYPE ${enumName} ADD VALUE IF NOT EXISTS '${value}'`, 'i'),
        `${enumName} should add ${value}`,
      )
    }
  }
})

test('evidence status enum repair includes a readback query', () => {
  assert.match(normalized, /from pg_type t join pg_enum e on e\.enumtypid = t\.oid/i)
  for (const enumName of enumNames) {
    assert.match(normalized, new RegExp(enumName, 'i'))
  }
})
