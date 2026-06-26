import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const wrapper = fs.readFileSync(new URL('../scripts/import/demo-fixtures-strict.mjs', import.meta.url), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('demo importer uses strict wrapper by default', () => {
  assert.equal(packageJson.scripts['import:demo'], 'node scripts/import/demo-fixtures-strict.mjs')
  assert.equal(packageJson.scripts['import:demo:base'], 'node scripts/import/demo-fixtures.mjs')
})

test('strict wrapper fails on item-level import errors', () => {
  assert.ok(wrapper.includes('demo-fixtures.mjs'))
  assert.ok(wrapper.includes('/^\\s*error:/im'))
  assert.ok(wrapper.includes('Demo import reported item-level errors'))
  assert.ok(wrapper.includes('process.exit(1)'))
})

test('strict wrapper prints linked demo pages to inspect', () => {
  assert.ok(wrapper.includes('demo-linked-content.json'))
  assert.ok(wrapper.includes('/works/demo-linked-work-cross-project'))
  assert.ok(wrapper.includes('/creators/demo-linked-creator-a'))
  assert.ok(wrapper.includes('/organizations/demo-linked-org-platform'))
  assert.ok(wrapper.includes('/evidence/demo-linked-evidence-cross'))
})
