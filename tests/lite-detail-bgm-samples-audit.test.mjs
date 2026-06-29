import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const auditScript = read('scripts/export/audit-lite-detail-bgm-samples.mjs')
const packageJson = JSON.parse(read('package.json'))

test('lite detail BGM sample audit covers canonical sample slugs', () => {
  for (const slug of ['百合星人奈绪子美眉', '百合少女', '百合少女-bgm-215570']) {
    assert.ok(auditScript.includes(`slug: '${slug}'`), `missing sample slug: ${slug}`)
  }
})

test('lite detail BGM sample audit checks media metadata and organizations', () => {
  for (const field of ['mediaGroup', 'mediaType', 'format', 'organizations']) {
    assert.match(auditScript, new RegExp(field))
  }

  assert.match(auditScript, /manga_series/)
  assert.match(auditScript, /assertNonEmptyArray\(item\.organizations/)
})

test('lite detail BGM sample audit guards object leaks and slug mixups', () => {
  assert.match(auditScript, /\[object Object\]/)
  assert.match(auditScript, /function assertUniqueWorkSlugs\(items\)/)
  assert.match(auditScript, /expectedId = `works:\$\{sample\.slug\}`/)
  assert.match(auditScript, /expectedUrl = `\/works\/\$\{sample\.slug\}`/)
})

test('package script exposes lite detail BGM sample audit command', () => {
  assert.equal(
    packageJson.scripts['audit:lite-detail-bgm-samples'],
    'node scripts/export/audit-lite-detail-bgm-samples.mjs',
  )
})
